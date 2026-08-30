import crypto from "node:crypto";
import { getTokens, saveTokens } from "./db.js";

export const FANVUE_AUTH_URL = "https://auth.fanvue.com/oauth2/auth";
export const FANVUE_TOKEN_URL = "https://auth.fanvue.com/oauth2/token";
export const FANVUE_SCOPES = ["read:chat", "write:chat", "read:self"].join(" ");

export function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/** Vrne veljaven Fanvue access token, osveži ga po potrebi. */
export async function getValidFanvueAccessToken() {
  const row = await getTokens("fanvue");
  if (!row) throw new Error("Fanvue še ni povezan. Obišči /api/auth/fanvue/start.");

  const stillValid = row.expires_at && row.expires_at - Date.now() > 60_000;
  if (stillValid) return row.access_token;

  if (!row.refresh_token) {
    throw new Error("Fanvue žeton je potekel brez refresh_token — potrebna je ponovna povezava.");
  }

  const basicAuth = Buffer.from(
    `${process.env.FANVUE_CLIENT_ID}:${process.env.FANVUE_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch(FANVUE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error("Fanvue refresh_token ni več veljaven — potrebna je ponovna povezava (/api/auth/fanvue/start).");
  }

  const tokens = await tokenRes.json();
  await saveTokens("fanvue", {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? row.refresh_token,
    expires_in: tokens.expires_in,
  });
  return tokens.access_token;
}

/**
 * Preveri X-Fanvue-Signature header (format: "t=<timestamp>,v0=<hex hmac>").
 * rawBody mora biti natančen surov niz telesa zahteve (ne parsiran JSON).
 */
export function verifyFanvueWebhookSignature(rawBody, signatureHeader, signingSecret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.trim().split("=").map((s) => s.trim()))
  );
  const { t, v0 } = parts;
  if (!t || !v0) return false;

  const signedPayload = `${t}.${rawBody}`;
  const expected = crypto.createHmac("sha256", signingSecret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v0));
  } catch {
    return false; // različna dolžina ipd.
  }
}
