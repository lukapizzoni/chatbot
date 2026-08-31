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

  console.log("Fanvue webhook raw payload:", rawBody.slice(0, 2000));

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("Fanvue webhook: telo ni veljaven JSON");
    res.status(200).json({ received: true, note: "invalid json, ignored" });
    return;
  }

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
    try {
      await logConversation({
        platform: "fanvue",
        external_chat_id: "neznano",
        fan_name: "neznano",
        incoming_message: null,
        ai_reply: null,
        status: "problem",
        reason: `Nisem prepoznal oblike sporočila. Surov payload (prvih 300 znakov): ${rawBody.slice(0, 300)}`,
      });
    } catch (e) {
      console.error("Napaka pri zapisu problema v bazo:", e.message);
    }
    res.status(200).json({ received: true, note: "no sender uuid found" });
    return;
  }

  // POMEMBNO: vsa obdelava se zgodi TUKAJ, PREDEN pošljemo odgovor.
  // Vercel lahko zamrzne izvajanje takoj po res.json(), zato ne smemo
  // pustiti nobene await-ane kode za odgovorom.
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

    res.status(200).json({ received: true, status: result.status });
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
    // Vseeno vrni 200, da Fanvue ne poskuša znova pošiljati istega
    // dogodka v neskončnost — napako smo že zabeležili v bazo.
    res.status(200).json({ received: true, status: "problem" });
  }
}
