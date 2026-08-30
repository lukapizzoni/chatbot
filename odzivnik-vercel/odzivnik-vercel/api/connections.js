import { getTokens } from "../lib/db.js";

export default async function handler(req, res) {
  const platforms = ["fanvue", "instagram", "tiktok"];
  const result = {};
  for (const p of platforms) {
    const t = await getTokens(p);
    result[p] = { connected: Boolean(t), account_label: t?.account_label ?? null };
  }
  res.status(200).json(result);
}
