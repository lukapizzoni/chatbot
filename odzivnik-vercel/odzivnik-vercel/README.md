# Odzivnik — Vercel/Supabase različica (brezplačna arhitektura)

Namesto strežnika, ki 24/7 "poizveduje" pri Fanvue (kar zahteva plačljivo
gostovanje), ta različica čaka na **webhook** — Fanvue nam sam pošlje
obvestilo v trenutku, ko fan napiše sporočilo. To pomeni:

- Nič ne teče, ko se nič ne dogaja → Vercelov brezplačen plan zadostuje.
- Odgovor pride hitreje (takoj, ne z zamikom do 30s kot pri pollingu).
- Namesto lokalne SQLite datoteke (ki na Vercelu ne bi preživela) uporabimo
  **Supabase** — brezplačna gostovana Postgres baza.

## 1. Ustvari Supabase projekt (brezplačno)

1. Pojdi na supabase.com → "New project" (brezplačen plan, brez kartice).
2. Ko je projekt ustvarjen, odpri **SQL Editor** → prilepi vsebino
   `sql/schema.sql` iz te mape → Run. To ustvari vse potrebne tabele.
3. Pojdi na **Settings → API** → prekopiraj `Project URL` in
   `service_role` ključ (NE `anon` ključa — service_role ima pravice pisanja,
   ki jih naš strežniški del rabi, in se nikoli ne izpostavi v brskalniku).

## 2. Postavi GitHub repozitorij

Enako kot prej — ustvari repo, naloži vanj vsebino te mape (`odzivnik-vercel`).

## 3. Deploy na Vercel

1. vercel.com → prijava z GitHub → "Add New Project" → izberi repo.
2. Pod "Environment Variables" vpiši vse iz `.env.example` (razen
   Instagram/TikTok, tista dodava kasneje): `OPENAI_API_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FANVUE_CLIENT_ID`,
   `FANVUE_CLIENT_SECRET`, `FANVUE_WEBHOOK_SECRET`, `FANVUE_REDIRECT_URI`
   (začasno pusti na localhost, popraviva po prvem deployu).
3. Klikni Deploy. Vercel ti da javen URL, npr. `https://odzivnik.vercel.app`.

## 4. Ustvari Fanvue OAuth aplikacijo

1. Fanvue Developer Area → nova OAuth aplikacija.
2. Redirect URI: `https://odzivnik.vercel.app/api/auth/fanvue/callback`
   (uporabi svoj pravi Vercel URL).
3. Prekopiraj Client ID in Client Secret.
4. V isti aplikaciji poišči zavihek **Webhooks** → dodaj endpoint:
   `https://odzivnik.vercel.app/api/webhooks/fanvue`, naroči se na dogodek
   **"Message Received"**. Prekopiraj "Signing secret".
5. Vse štiri vrednosti (Client ID, Client Secret, Redirect URI, Webhook
   Secret) posodobi v Vercel → Settings → Environment Variables. Vercel ob
   vsaki spremembi samodejno znova deploya.

## 5. Poveži svoj Fanvue račun

Obišči `https://odzivnik.vercel.app/api/auth/fanvue/start` v brskalniku,
prijavi se in odobri dostop. Od tega trenutka naprej: vsak fan, ki ti piše,
dobi AI odgovor po tvojih navodilih — samodejno, brez da karkoli poganjaš.

## Struktura

```
api/
  webhooks/fanvue.js       # sprejme Fanvue "message received" dogodek, odgovori
  auth/fanvue/start.js     # začne OAuth prijavo
  auth/fanvue/callback.js  # dokonča OAuth prijavo, shrani žetone
  settings/[platform].js   # GET/PUT navodila + sprožilne besede
  conversations.js         # zgodovina pogovorov za dashboard
  stats.js                 # statistika za dashboard
  connections.js           # status povezav po platformah
lib/
  db.js             # Supabase klic-funkcije
  fanvueAuth.js     # OAuth2 + PKCE + preverjanje webhook podpisa
  fanvueApi.js      # klici na pravi Fanvue API
  openaiService.js  # generiranje odgovorov + zaznava problemov
sql/schema.sql       # zaženi v Supabase SQL Editorju
```

## Naslednji koraki: Instagram in TikTok

Enak vzorec (webhook + `lib/instagramApi.js` / `lib/tiktokApi.js`) dodava,
ko bosta odobrena dostopa — glej roadmap v prejšnjem sporočilu.
