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

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("Fanvue webhook: telo ni veljaven JSON");
    return;
  }

  const senderUuid = payload?.sender?.uuid;
  const incomingMessage = payload?.message?.text || "";
  const fanName = payload?.sender?.displayName || payload?.sender?.handle || senderUuid;

  if (!senderUuid) {
    console.error("Fanvue webhook: manjka sender.uuid, preskačem");
    return;
  }

  try {
    const settings = await getSettings("fanvue");

    const rawHistory = await getChatMessages(senderUuid, 8).catch(() => []);
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

    if (result.status === "ok" && settings.auto_reply_enabled) {
      await sendChatMessage(senderUuid, result.reply);
    }

    await logConversation({
      platform: "fanvue",
      external_chat_id: senderUuid,
      fan_name: fanName,
      incoming_message: incomingMessage,
      ai_reply: result.reply,
      status: result.status,
      reason: result.reason,
    });
  } catch (err) {
    console.error("Napaka pri obdelavi Fanvue sporočila:", err);
    await logConversation({
      platform: "fanvue",
      external_chat_id: senderUuid,
      fan_name: fanName,
      incoming_message: incomingMessage,
      ai_reply: null,
      status: "problem",
      reason: `Tehnična napaka: ${err.message}`,
    }).catch(() => {});
  }
}
