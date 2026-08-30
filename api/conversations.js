import { getRecentConversations } from "../lib/db.js";

export default async function handler(req, res) {
  const { platform, limit } = req.query;
  const rows = await getRecentConversations(platform, Number(limit) || 50);
  res.status(200).json(rows);
}
