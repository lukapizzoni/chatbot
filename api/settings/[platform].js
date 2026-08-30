import { getSettings, updateSettings } from "../../lib/db.js";

export default async function handler(req, res) {
  const { platform } = req.query;
  const allowed = ["fanvue", "instagram", "tiktok"];
  if (!allowed.includes(platform)) {
    res.status(404).json({ error: "Neznana platforma" });
    return;
  }

  if (req.method === "GET") {
    const settings = await getSettings(platform);
    res.status(200).json(settings);
    return;
  }

  if (req.method === "PUT") {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    const updated = await updateSettings(platform, body || {});
    res.status(200).json(updated);
    return;
  }

  res.status(405).send("Method not allowed");
}
