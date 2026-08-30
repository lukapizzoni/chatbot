import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
    "Odgovori kratko (1-3 povedi), v slovenščini, v naravnem in prijaznem tonu.",
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
