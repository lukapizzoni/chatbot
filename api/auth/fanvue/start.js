import { FANVUE_AUTH_URL, FANVUE_SCOPES, createPkcePair, base64url } from "../../../lib/fanvueAuth.js";
import crypto from "node:crypto";

// Poenostavljeno: code_verifier pošljemo nazaj kot podpisan del "state" parametra,
// namesto v sejo/cookie (na Vercelu ni privzete strežniške seje med funkcijami).
// State = <naključen niz>.<code_verifier>, oboje preveri callback.
export default async function handler(req, res) {
  const { codeVerifier, codeChallenge } = createPkcePair();
  const nonce = base64url(crypto.randomBytes(8));
  const state = `${nonce}.${codeVerifier}`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.FANVUE_CLIENT_ID,
    redirect_uri: process.env.FANVUE_REDIRECT_URI,
    scope: FANVUE_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  res.writeHead(302, { Location: `${FANVUE_AUTH_URL}?${params.toString()}` });
  res.end();
}
