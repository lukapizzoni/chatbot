import { getValidFanvueAccessToken } from "./fanvueAuth.js";

const API_BASE = "https://api.fanvue.com";
const API_VERSION = "2025-06-26";

async function fanvueRequest(pathname, options = {}) {
  const accessToken = await getValidFanvueAccessToken();
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Fanvue-API-Version": API_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Fanvue API ${res.status} na ${pathname}: ${detail}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Zadnja sporočila v klepetu s tem fanom, za kontekst pri odgovoru. */
export async function getChatMessages(userUuid, limit = 15) {
  const data = await fanvueRequest(`/chats/${userUuid}/messages?limit=${limit}`);
  return data?.data ?? data?.messages ?? data ?? [];
}

/** Pošlje besedilni odgovor temu faninu. */
export async function sendChatMessage(userUuid, text) {
  return fanvueRequest(`/chats/${userUuid}/message`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}
