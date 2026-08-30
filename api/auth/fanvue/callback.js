import { FANVUE_TOKEN_URL } from "../../../lib/fanvueAuth.js";
import { saveTokens } from "../../../lib/db.js";

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    res.status(400).send(`Fanvue je zavrnil povezavo: ${error}`);
    return;
  }
  if (!state || !state.includes(".")) {
    res.status(400).send("Manjkajoč ali neveljaven state parameter. Poskusi znova od /api/auth/fanvue/start.");
    return;
  }
  const codeVerifier = state.slice(state.indexOf(".") + 1);

  try {
    const tokenRes = await fetch(FANVUE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.FANVUE_CLIENT_ID,
        client_secret: process.env.FANVUE_CLIENT_SECRET,
        code,
        redirect_uri: process.env.FANVUE_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      console.error("Fanvue token exchange failed:", detail);
      res.status(502).send("Napaka pri pridobivanju Fanvue žetona. Preveri Vercel loge.");
      return;
    }

    const tokens = await tokenRes.json();
    await saveTokens("fanvue", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`
      <html><body style="font-family:sans-serif;background:#101216;color:#eceef1;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center">
          <h2>Fanvue je povezan ✅</h2>
          <p>Zdaj še v Fanvue Developer Area vklopi webhook za "message received" proti /api/webhooks/fanvue.</p>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("Nepričakovana napaka pri povezovanju s Fanvue.");
  }
}
