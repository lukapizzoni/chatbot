import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Service Role ključ, NE anon ključ - ta koda teče samo na strežniku
);

export async function getSettings(platform) {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("*")
    .eq("platform", platform)
    .single();
  if (error) throw error;
  return data;
}

export async function updateSettings(platform, { instructions, trigger_words, auto_reply_enabled }) {
  const patch = {};
  if (instructions !== undefined) patch.instructions = instructions;
  if (trigger_words !== undefined) patch.trigger_words = trigger_words;
  if (auto_reply_enabled !== undefined) patch.auto_reply_enabled = auto_reply_enabled;

  const { data, error } = await supabase
    .from("platform_settings")
    .update(patch)
    .eq("platform", platform)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function logConversation({ platform, external_chat_id, fan_name, incoming_message, ai_reply, status, reason }) {
  const { error } = await supabase.from("conversations").insert({
    platform,
    external_chat_id,
    fan_name,
    incoming_message,
    ai_reply,
    status,
    reason: reason ?? null,
    created_at: Date.now(),
  });
  if (error) throw error;
}

export async function getRecentConversations(platform, limit = 50) {
  let query = supabase.from("conversations").select("*").order("created_at", { ascending: false }).limit(limit);
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getStats() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const { data, error } = await supabase.from("conversations").select("platform, status").gte("created_at", since);
  if (error) throw error;

  const byPlatform = {};
  for (const row of data) {
    byPlatform[row.platform] ??= { platform: row.platform, total: 0, problems: 0, waiting: 0 };
    byPlatform[row.platform].total++;
    if (row.status === "problem") byPlatform[row.platform].problems++;
    if (row.status === "warn") byPlatform[row.platform].waiting++;
  }
  return Object.values(byPlatform);
}

export async function saveTokens(platform, { access_token, refresh_token, expires_in, account_label }) {
  const expires_at = expires_in ? Date.now() + expires_in * 1000 : null;
  const { error } = await supabase.from("oauth_tokens").upsert({
    platform,
    access_token,
    refresh_token: refresh_token ?? null,
    expires_at,
    account_label: account_label ?? null,
    updated_at: Date.now(),
  });
  if (error) throw error;
}

export async function getTokens(platform) {
  const { data, error } = await supabase.from("oauth_tokens").select("*").eq("platform", platform).maybeSingle();
  if (error) throw error;
  return data;
}
