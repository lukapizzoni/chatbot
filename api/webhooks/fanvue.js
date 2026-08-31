import { verifyFanvueWebhookSignature } from "../../lib/fanvueAuth.js";
import { getChatMessages, sendChatMessage } from "../../lib/fanvueApi.js";
import { generateReply } from "../../lib/openaiService.js";
import { getSettings, logConversation } from "../../lib/db.js";

// Rabimo surovo (raw) telo zahteve za preverjanje podpisa, zato izklopimo
// samodejno parsiranje JSON-a s strani Vercela.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-fanvue-signature"];
  const valid = verifyFanvueWebhookSignature(rawBody, signature, process.env.FANVUE_WEBHOOK_SECRET);

  if (!valid) {
    console.error("Neveljaven Fanvue webhook podpis — zavračam.");
    res.status(401).send("Invalid signature");
    return;
  }

  // Vrni 2xx TAKOJ, kot zahteva Fanvue dokumentacija, šele nato obdelaj.
  res.status(200).json({ received: true });

  // Vedno izpiši surov payload v loge - dokler ne potrdimo točne oblike
  // podatkov, ki jih Fanvue dejansko pošilja, je to edini način, da vidimo,
  // zakaj ekstrakcija polj morda ne uspe.
  console.log("Fanvue webhook raw payload:", rawBody.slice(0, 2000));

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("Fanvue webhook: telo ni veljaven JSON");
    return;
  }

  // Poskusi več možnih oblik polj, ker se lahko struktura razlikuje
  // glede na to, ali gre za legacy 'Message Received' ali novejši dogodek.
  const senderUuid =
    payload?.sender?.uuid ||
    payload?.senderUuid ||
    payload?.data?.sender?.uuid ||
    payload?.data?.senderUuid ||
    payload?.userUuid;

  const incomingMessage =
    payload?.message?.text ||
    payload?.message?.content ||
    payload?.text ||
    payload?.content ||
    payload?.data?.message?.text ||
    payload?.data?.content ||
    "";

  const fanName =
    payload?.sender?.displayName ||
    payload?.sender?.handle ||
    payload?.data?.sender?.displayName ||
    senderUuid ||
    "neznan";

  if (!senderUuid) {
    console.error("Fanvue webhook: ni bilo mogoče najti sender uuid v payloadu");
    // Zapiši v bazo, da vsaj vidiš na dashboardu, da se je nekaj zgodilo,
    // namesto tihega izginotja.
    await logConversation({
      platform: "fanvue",
      external_chat_id: "neznano",
      fan_name: "neznano",
      incoming_message: null,
      ai_reply: null,
      status: "problem",
      reason: `Nisem prepoznal oblike sporočila. Surov payload (prvih 300 znakov): ${rawBody.slice(0, 300)}`,
    }).catch((e) => console.error("Napaka pri zapisu problema v bazo:", e));
    return;
  }

  try {
    console.log("Fanvue webhook: berem nastavitve...");
    const settings = await getSettings("fanvue");
    console.log("Fanvue webhook: nastavitve prebrane, berem zgodovino sporočil...");

    const rawHistory = await getChatMessages(senderUuid, 8).catch((e) => {
      console.error("Napaka pri branju zgodovine sporočil:", e.message);
      return [];
    });
    console.log("Fanvue webhook: zgodovina prebrana, generiram odgovor...");
    const history = rawHistory.map((m) => ({
      fromFan: m.senderUuid ? m.senderUuid === senderUuid : true,
      content: m.content || m.text || "",
    }));

    const result = await generateReply({
      platform: "fanvue",
      instructions: settings.instructions,
      triggerWords: settings.trigger_words,
      history,
      incomingMessage,
    });
    console.log("Fanvue webhook: odgovor generiran, status:", result.status);

    if (result.status === "ok" && settings.auto_reply_enabled) {
      console.log("Fanvue webhook: pošiljam odgovor...");
      await sendChatMessage(senderUuid, result.reply);
      console.log("Fanvue webhook: odgovor poslan.");
    }

    console.log("Fanvue webhook: zapisujem v bazo...");
    await logConversation({
      platform: "fanvue",
      external_chat_id: senderUuid,
      fan_name: fanName,
      incoming_message: incomingMessage,
      ai_reply: result.reply,
      status: result.status,
      reason: result.reason,
    });
    console.log("Fanvue webhook: uspešno zaključeno.");
  } catch (err) {
    console.error("Napaka pri obdelavi Fanvue sporočila:", err.message, err.stack);
    try {
      await logConversation({
        platform: "fanvue",
        external_chat_id: senderUuid,
        fan_name: fanName,
        incoming_message: incomingMessage,
        ai_reply: null,
        status: "problem",
        reason: `Tehnična napaka: ${err.message}`,
      });
    } catch (dbErr) {
      console.error("KRITIČNO: tudi zapis napake v bazo ni uspel:", dbErr.message, dbErr.stack);
    }
  }
}
