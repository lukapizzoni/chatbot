import OpenAI from "openai";

// Če je nastavljen DEEPINFRA_API_KEY, uporabimo DeepInfra namesto OpenAI
// (DeepInfra ponuja z OpenAI skladen vmesnik, zato zadostuje zamenjava
// baseURL + ključa + imena modela — preostala koda ostane nespremenjena).
const usingDeepInfra = Boolean(process.env.DEEPINFRA_API_KEY);

const client = new OpenAI({
  apiKey: usingDeepInfra ? process.env.DEEPINFRA_API_KEY : process.env.OPENAI_API_KEY,
  baseURL: usingDeepInfra ? "https://api.deepinfra.com/v1/openai" : undefined,
});

const MODEL = usingDeepInfra
  ? process.env.DEEPINFRA_MODEL || "Sao10K/L3.3-70B-Euryale-v2.3"
  : process.env.OPENAI_MODEL || "gpt-4o-mini";

const HUMAN_REQUEST_PATTERNS = [
  /pravo osebo/i,
  /živo osebo/i,
  /real(ni)? person/i,
  /talk to a human/i,
  /pogovor.*osebo/i,
];

function looksEmptyOrUnintelligible(text) {
  if (!text) return true;
  const stripped = text.trim();
  if (stripped.length === 0) return true;
  const hasLetterOrDigit = /[\p{L}\p{N}]/u.test(stripped);
  return !hasLetterOrDigit;
}

export async function generateReply({ platform, instructions, triggerWords, history, incomingMessage }) {
  if (looksEmptyOrUnintelligible(incomingMessage)) {
    return { status: "problem", reply: null, reason: "Prazno ali nerazumljivo sporočilo — potreben ročni pregled" };
  }

  if (HUMAN_REQUEST_PATTERNS.some((re) => re.test(incomingMessage))) {
    return {
      status: "warn",
      reply: "Hvala za sporočilo! Nekdo iz ekipe se ti bo osebno oglasil v najkrajšem možnem času.",
      reason: "Uporabnik zahteva pogovor s človekom",
    };
  }

  const matchedTriggers = (triggerWords || []).filter((w) =>
    incomingMessage.toLowerCase().includes(String(w).toLowerCase())
  );

  const systemPrompt = [
    `Si AI asistent, ki v imenu uporabnika odgovarja na sporočila na platformi ${platform}.`,
    `Navodila lastnika računa (upoštevaj jih dobesedno):`,
    instructions,
    matchedTriggers.length
      ? `V sporočilu so zaznane sprožilne besede: ${matchedTriggers.join(", ")}. Bodi pri odgovoru posebej pozoren na to temo.`
      : "",
    "Odgovori kratko (1-3 povedi), v naravnem in prijaznem tonu.",
    "POMEMBNO — jezik: zaznaj, v katerem jeziku je napisano PREJETO sporočilo, in odgovori v ISTEM jeziku (tudi če so zgornja navodila napisana v slovenščini). Če je sporočilo v angleščini, odgovori v angleščini; če v nemščini, odgovori v nemščini; itd.",
    "Če ne poznaš konkretnega dejstva (cena, datum, zaloga ipd.), tega ne izmisli — povej, da bo oseba to preverila.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    ...(history || []).map((m) => ({ role: m.fromFan ? "user" : "assistant", content: m.content })),
    { role: "user", content: incomingMessage },
  ];

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 250,
  });

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    return { status: "problem", reply: null, reason: "OpenAI ni vrnil odgovora" };
  }
  return { status: "ok", reply, reason: null };
}
