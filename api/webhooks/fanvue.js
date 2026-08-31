import { waitUntil } from "@vercel/functions";
import { verifyFanvueWebhookSignature } from "../../lib/fanvueAuth.js";
import { getChatMessages, sendChatMessage } from "../../lib/fanvueApi.js";
import { generateReply } from "../../lib/openaiService.js";
import { getSettings, logConversation, getMediaCatalog, wasEventAlreadyProcessed } from "../../lib/db.js";

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function processMessage({ senderUuid, incomingMessage, fanName, eventId }) {
  try {
    console.log(`[${eventId}] berem nastavitve...`);
    const settings = await getSettings("fanvue");

    const rawHistory = await getChatMessages(senderUuid, 8).catch((e) => {
      console.error(`[${eventId}] Napaka pri branju zgodovine:`, e.message);
      return [];
    });
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
    console.log(`[${eventId}] odgovor generiran, status: ${result.status}`);

    if (result.status === "ok" && settings.auto_reply_enabled) {
      const catalog = await getMediaCatalog("fanvue").catch(() => []);
      const lowerMsg = incomingMessage.toLowerCase();
      const matchedMedia = catalog.find(
        (item) => item.active && (item.tags || []).some((tag) => lowerMsg.includes(String(tag).toLowerCase()))
      );

      await sendChatMessage(
        senderUuid,
        result.reply,
        matchedMedia
          ? { mediaUuids: [matchedMedia.media_uuid], price: matchedMedia.price_cents || undefined }
          : undefined
      );
      console.log(`[${eventId}] odgovor poslan.`);
    }

    await logConversation({
      platform: "fanvue",
      external_chat_id: senderUuid,
      fan_name: fanName,
      incoming_message: incomingMessage,
      ai_reply: result.reply,
      status: result.status,
      reason: result.reason,
      event_id: eventId,
    });
    console.log(`[${eventId}] zaključeno.`);
  } catch (err) {
    console.error(`[${eventId}] Napaka pri obdelavi:`, err.message);
    try {
      await logConversation({
        platform: "fanvue",
        external_chat_id: senderUuid,
        fan_name: fanName,
        incoming_message: incomingMessage,
        ai_reply: null,
        status: "problem",
        reason: `Tehnična napaka: ${err.message}`,
        event_id: eventId,
      });
    } catch (dbErr) {
      console.error(`[${eventId}] KRITIČNO: tudi zapis napake ni uspel:`, dbErr.message);
    }
  }
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

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(200).json({ received: true, note: "invalid json" });
    return;
  }

  const senderUuid =
    payload?.sender?.uuid || payload?.senderUuid || payload?.data?.sender?.uuid || payload?.userUuid;
  const incomingMessage =
    payload?.message?.text || payload?.message?.content || payload?.text || payload?.content || "";
  const fanName = payload?.sender?.displayName || payload?.sender?.handle || senderUuid || "neznan";
  const eventId = payload?.eventId || payload?.messageUuid || payload?.message?.uuid || null;

  if (!senderUuid) {
    res.status(200).json({ received: true, note: "no sender uuid" });
    return;
  }

  // Zaščita pred podvojenimi dostavami (Fanvue lahko isti dogodek pošlje
  // večkrat, če naš odgovor ni bil dovolj hiter). Preverimo TAKOJ, sinhrono,
  // preden sploh pošljemo odgovor - da ne zaženemo drugega procesiranja.
  if (eventId) {
    const already = await wasEventAlreadyProcessed(eventId).catch(() => false);
    if (already) {
      console.log(`[${eventId}] Podvojena dostava - preskačem.`);
      res.status(200).json({ received: true, note: "duplicate, skipped" });
      return;
    }
  }

  // Takoj vrni 200 (Fanvue ne bo poskušal znova), obdelava teče v ozadju
  // prek waitUntil, ki zanesljivo dokonča izvajanje tudi po odgovoru.
  res.status(200).json({ received: true });
  waitUntil(processMessage({ senderUuid, incomingMessage, fanName, eventId }));
}
