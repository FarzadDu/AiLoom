import { createChatCompletion, type ChatMessage } from "../providers/openrouter";
import type { WebSearchAnswer } from "./web-search";
import medlinePlus from "./medlineplus-topics.json";

type KnowledgeCard = {
  slug: string;
  title: string;
  url: string;
  summary: string;
  terms: readonly string[];
  origin?: "medlineplus-snapshot";
};

// Short, paraphrased notes checked against the linked primary pages on 2026-09-25.
// This is a deliberately small reviewed corpus, not a live medical search index.
const cards: readonly KnowledgeCard[] = [
  {
    slug: "general-health", title: "MedlinePlus — When to use the emergency room",
    url: "https://medlineplus.gov/ency/patientinstructions/000593.htm",
    summary: "Severe chest pain or pressure, severe breathing difficulty, sudden one-sided weakness or inability to speak, a serious allergic reaction with breathing trouble, fainting, and heavy bleeding are examples for immediate local emergency care. The page says to use the local emergency number outside the US.",
    terms: ["emergency", "chest pain", "chest pressure", "breathing difficulty", "trouble breathing", "fainting", "unconscious", "seizure", "heavy bleeding", "allergic reaction", "اورژانس", "درد قفسه سینه", "تنگی نفس", "بیهوش", "غش", "تشنج", "خونریزی شدید", "حساسیت شدید"]
  },
  {
    slug: "general-health", title: "CDC — Signs and symptoms of stroke",
    url: "https://www.cdc.gov/stroke/signs-symptoms/index.html",
    summary: "Sudden one-sided face, arm or leg weakness, speech or understanding trouble, vision trouble, balance trouble, or an unexplained severe headache can be stroke warning signs; call local emergency services immediately.",
    terms: ["stroke", "one-sided weakness", "face droop", "slurred speech", "sudden weakness", "سکته مغزی", "کجی صورت", "ضعف یک طرف", "اختلال گفتار", "فلج ناگهانی"]
  },
  {
    slug: "general-health", title: "MedlinePlus — Make the most of your doctor visit",
    url: "https://medlineplus.gov/ency/patientinstructions/000860.htm",
    summary: "Before a visit, record symptoms, their onset and changes, questions, all medicines and supplements, and relevant medical history. Contact a clinician for worsening or new unexplained symptoms or medication side effects.",
    terms: ["doctor visit", "appointment", "prepare for doctor", "medical test", "test result", "medicine side effect", "medication side effect", "supplement", "ویزیت", "مراجعه به پزشک", "آزمایش", "نتیجه آزمایش", "عوارض دارو", "داروها", "مکمل"]
  },
  {
    slug: "general-health", title: "MedlinePlus — Headaches: danger signs",
    url: "https://medlineplus.gov/ency/patientinstructions/000424.htm",
    summary: "A sudden, very severe headache, especially with neurological changes or fever and a stiff neck, needs prompt medical assessment; some headache patterns warrant emergency care.",
    terms: ["headache", "migraine", "severe head pain", "سردرد", "میگرن", "درد سر"]
  },
  {
    slug: "skin-and-hair", title: "American Academy of Dermatology — Skin cancer signs",
    url: "https://www.aad.org/public/diseases/skin-cancer",
    summary: "A growing, bleeding, changing or non-healing skin spot should be evaluated by a dermatologist. A skin biopsy is needed to diagnose skin cancer; a photo or chatbot cannot establish or rule it out.",
    terms: ["mole", "melanoma", "skin cancer", "changing spot", "bleeding spot", "skin lesion", "خال", "ملانوما", "سرطان پوست", "لکه پوستی", "ضایعه پوستی", "خال در حال تغییر", "لکه خونریزی"]
  },
  {
    slug: "skin-and-hair", title: "American Academy of Dermatology — Acne diagnosis and treatment",
    url: "https://www.aad.org/public/diseases/acne/derm-treat/treat",
    summary: "A dermatologist assesses the type and location of breakouts; several other conditions can resemble acne. Treatment depends on the person and type of lesion, and improvement may take weeks. This page does not support diagnosing from an image alone.",
    terms: ["acne", "pimple", "breakout", "comedone", "جوش", "آکنه", "جوش صورت", "سرسیاه", "سرسفید"]
  },
  {
    slug: "skin-and-hair", title: "American Academy of Dermatology — Hair loss signs",
    url: "https://www.aad.org/public/diseases/hair-loss/insider/begin",
    summary: "Hair loss can be gradual thinning, a widening part or receding hairline, but sometimes appears as sudden bald patches or clumps. Pattern alone does not establish the cause; a dermatologist can assess it.",
    terms: ["hair loss", "hair thinning", "bald patch", "alopecia", "receding hairline", "ریزش مو", "کم پشتی مو", "طاسی", "آلوپسی", "ریختن مو"]
  },
  {
    slug: "mental-wellbeing", title: "WHO — Depressive disorder",
    url: "https://www.who.int/news-room/fact-sheets/detail/depression",
    summary: "A depressive episode can include persistent low mood or loss of interest most of the day, nearly every day, for at least two weeks. Effective psychological treatments exist; people with symptoms should seek professional care. This description is not a diagnosis.",
    terms: ["depression", "depressed", "low mood", "loss of interest", "hopeless", "افسردگی", "افسرده", "بی علاقگی", "بی‌علاقگی", "ناامیدی", "غمگین"]
  },
  {
    slug: "mental-wellbeing", title: "NIMH — Generalized anxiety disorder",
    url: "https://www.nimh.nih.gov/health/publications/generalized-anxiety-disorder-gad",
    summary: "Occasional worry differs from persistent, hard-to-control anxiety that interferes with daily life. A qualified health professional can assess symptoms, duration and impact; the page describes treatment and support options.",
    terms: ["anxiety", "anxious", "worry", "gad", "اضطراب", "نگرانی", "استرس مداوم", "دلشوره"]
  },
  {
    slug: "mental-wellbeing", title: "WHO — Stress",
    url: "https://www.who.int/news-room/questions-and-answers/item/stress",
    summary: "Stress can affect mind and body. Routines, sleep, connecting with others and activity may help; persistent stress that impairs daily function can warrant help from a trusted health professional.",
    terms: ["stress", "overwhelmed", "stressed", "استرس", "فشار روانی", "کلافه"]
  },
  {
    slug: "mental-wellbeing", title: "NIMH — Warning signs of suicide",
    url: "https://www.nimh.nih.gov/health/publications/warning-signs-of-suicide",
    summary: "Talking about wanting to die, feeling trapped or a burden, making a plan, saying goodbye, or giving away important items may be warning signs. NIMH urges seeking help promptly, especially for new or escalating signs. Its 988 crisis referral applies to the United States.",
    terms: ["suicide", "self-harm", "kill myself", "want to die", "hurt myself", "ending my life", "خودکشی", "خودآزاری", "آسیب به خود", "می‌خواهم بمیرم", "میخوام بمیرم", "کشتن خودم", "مرگ خودم"]
  },
  {
    slug: "mental-wellbeing", title: "WHO — Depressive disorder: immediate danger guidance",
    url: "https://www.who.int/news-room/fact-sheets/detail/depression",
    summary: "For immediate danger of self-harm, WHO advises contacting available local emergency services or a crisis line. It also encourages talking with a trusted person and health worker when suicidal thoughts occur.",
    terms: ["suicide", "self-harm", "kill myself", "want to die", "hurt myself", "ending my life", "خودکشی", "خودآزاری", "آسیب به خود", "می‌خواهم بمیرم", "میخوام بمیرم", "کشتن خودم", "مرگ خودم"]
  }
];

function normalized(value: string): string {
  return value.toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u064b-\u065f\u0670]/g, "").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
}

function termMatches(text: string, rawTerm: string): boolean {
  const term = normalized(rawTerm);
  if (/^[a-z0-9 -]+$/.test(term)) {
    return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`).test(text);
  }
  return text.includes(term);
}

const specialistGroups = new Set(["Skin, Hair and Nails", "Mental Health and Behavior", "Substance Use and Disorders"]);

function belongsToSpecialist(slug: string, groups: readonly string[]): boolean {
  if (slug === "skin-and-hair") return groups.includes("Skin, Hair and Nails");
  if (slug === "mental-wellbeing") return groups.includes("Mental Health and Behavior") || groups.includes("Substance Use and Disorders");
  if (slug === "general-health") return !groups.some(group => specialistGroups.has(group));
  return false;
}

const corpus = medlinePlus.topics.map(topic => ({
  card: {
    slug: "", title: `MedlinePlus — ${topic.title}`, url: topic.url,
    summary: topic.summary, terms: [topic.title, ...topic.aliases],
    origin: "medlineplus-snapshot" as const
  },
  groups: topic.groups,
  names: [topic.title, ...topic.aliases].map(name => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
}));

// Small explicit map for common Persian terms. Other Persian questions still use
// the reviewed bilingual cards; no private user query is sent to MedlinePlus.
const persianTopics: Readonly<Record<string, readonly { term: string; title: string }[]>> = {
  "general-health": [
    { term: "فشار خون بالا", title: "High Blood Pressure" },
    { term: "پرفشاری خون", title: "High Blood Pressure" },
    { term: "دیابت", title: "Diabetes" },
    { term: "آسم", title: "Asthma" },
    { term: "سرماخوردگی", title: "Common Cold" },
    { term: "کم خونی", title: "Anemia" }
  ],
  "skin-and-hair": [
    { term: "اگزما", title: "Eczema" },
    { term: "پسوریازیس", title: "Psoriasis" },
    { term: "کهیر", title: "Hives" }
  ],
  "mental-wellbeing": [
    { term: "وسواس فکری", title: "Obsessive-Compulsive Disorder" },
    { term: "اختلال وسواس", title: "Obsessive-Compulsive Disorder" },
    { term: "اختلال دوقطبی", title: "Bipolar Disorder" }
  ]
};

const genericWords = new Set([
  "about", "and", "are", "can", "care", "condition", "disease", "disorder", "doctor",
  "for", "from", "health", "help", "how", "medical", "need", "problems", "symptom",
  "symptoms", "test", "tests", "the", "treatment", "what", "when", "with"
]);

function englishWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => word.length > 2 && !genericWords.has(word));
}

function corpusRank(slug: string, query: string): KnowledgeCard[] {
  const text = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = new Set(englishWords(text));
  const mapped = (persianTopics[slug] || []).filter(entry => termMatches(normalized(query), entry.term))
    .map(entry => entry.title);
  if (!words.size && !mapped.length) return [];
  return corpus.filter(entry => belongsToSpecialist(slug, entry.groups)).map(entry => {
    let score = mapped.includes(entry.card.title.slice("MedlinePlus — ".length)) ? 200 : 0;
    for (const name of entry.names) {
      const nameWords = [...new Set(englishWords(name))];
      if (!nameWords.length) continue;
      if (text && termMatches(text, name)) {
        score = Math.max(score, 100 + nameWords.length * 15);
      } else {
        const overlap = nameWords.filter(word => words.has(word)).length;
        // All meaningful name words must be present. Partial overlap can pair
        // contradictory topics such as high and low blood pressure.
        if (overlap >= 2 && overlap === nameWords.length) {
          score = Math.max(score, 50 + overlap * 10);
        }
      }
    }
    return { card: entry.card, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.card.title.localeCompare(b.card.title))
    .filter((item, index, ranked) => item.score >= ranked[0].score - 10)
    .slice(0, 3).map(item => item.card);
}

/** Prefer reviewed cards, then locally indexed official MedlinePlus topics. */
export function retrieveSpecialistKnowledge(slug: string, query: string, priorUserText: readonly string[] = []): KnowledgeCard[] {
  const domain = cards.filter(card => card.slug === slug);
  const rank = (text: string) => domain.map(card => ({ card, score: card.terms.filter(term => termMatches(text, term)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  for (const text of [query, priorUserText.at(-1) || ""]) {
    if (!text) continue;
    const reviewed = rank(normalized(text));
    if (reviewed.length) return reviewed.slice(0, 3).map(item => item.card);
    const topics = corpusRank(slug, text);
    if (topics.length) return topics;
  }
  return [];
}

export function specialistFallback(slug: string, query: string): string {
  const fa = /[\u0600-\u06ff]/.test(query);
  const crisis = slug === "mental-wellbeing" && ["suicide", "self-harm", "kill myself", "want to die", "hurt myself", "خودکشی", "خودآزاری", "میخوام بمیرم", "می خواهم بمیرم"].some(term => termMatches(normalized(query), term));
  if (crisis) return fa
    ? "متأسفم که این وضعیت را تجربه می‌کنی. اگر خطر فوری وجود دارد، همین حالا با خدمات اورژانس یا خط بحران محل زندگی‌ات تماس بگیر و به فرد مورد اعتمادی در نزدیکی‌ات خبر بده. من جای کمک فوری حضوری را نمی‌گیرم."
    : "I'm sorry you're going through this. If you may be in immediate danger, contact your local emergency or crisis service now and tell someone you trust nearby. I can't replace immediate in-person help.";
  return fa
    ? "برای این پرسش در منابع آفلاین سلامت Ailoom فعلاً مرجع کافی پیدا نکردم و نمی‌خواهم پاسخ پزشکی بدون پشتوانه بدهم. اگر علائم یا نگرانی مشخص‌تری بگویی، می‌توانم دوباره در همین منابع جست‌وجو کنم. برای تصمیم شخصی با متخصص واجد صلاحیت مشورت کن؛ در خطر فوری با اورژانس محل تماس بگیر."
    : "I couldn't find a relevant page in Ailoom's offline health sources, so I can't give a grounded health answer to this question. If you share the specific symptom or concern, I can check these sources again. Consult a qualified professional for personal decisions; contact local emergency services for immediate danger.";
}

function unverifiedAnswerFallback(query: string): string {
  return /[\u0600-\u06ff]/.test(query)
    ? "منبع مرتبط پیدا شد، اما نتوانستم پاسخ تولیدشده را با ارجاع معتبر به همان منبع تأیید کنم. لطفاً پرسش را دقیق‌تر مطرح کن یا برای تصمیم درمانی با متخصص واجد صلاحیت مشورت کن."
    : "I found a relevant reference, but could not verify the generated answer against it. Please ask a more specific question or consult a qualified professional for treatment decisions.";
}

function isPersonalDoseQuestion(query: string): boolean {
  const text = normalized(query);
  return (/\b(dose|dosage|mg|milligrams)\b/.test(text) && /\b(my|me|mine|for me|should i)\b/.test(text))
    || (/\bhow much\b.*\b(take|use|consume)\b/.test(text) && /\b(i|my|me)\b/.test(text))
    || (/(دوز|مقدار مصرف)/.test(text) && /(من|برای من|باید)/.test(text))
    || (/چقدر/.test(text) && /مصرف (کنم|بکنم)/.test(text));
}

function personalDoseFallback(query: string): string {
  return /[\u0600-\u06ff]/.test(query)
    ? "از اطلاعات این مجموعه نمی‌توان دوز مناسب برای وضعیت شخصی تو را تعیین کرد. برای مقدار مصرف با پزشک یا داروساز واجد صلاحیت مشورت کن."
    : "These sources cannot establish a safe dose for your personal condition. Ask a qualified clinician or pharmacist about the amount to take.";
}

function urgentAnswer(slug: string, query: string, selected: readonly KnowledgeCard[]): WebSearchAnswer | null {
  const text = normalized(query);
  const fa = /[\u0600-\u06ff]/.test(query);
  const reference = (url: string) => {
    const index = selected.findIndex(card => card.url === url);
    return index < 0 ? null : { marker: `[S${index + 1}]`, source: {
      title: `[S${index + 1}] ${selected[index].title}`, url: selected[index].url
    } };
  };
  if (slug === "general-health") {
    const emergency = reference("https://medlineplus.gov/ency/patientinstructions/000593.htm");
    if (emergency && ["chest pain", "chest pressure", "trouble breathing", "breathing difficulty", "fainting", "unconscious", "seizure", "heavy bleeding", "allergic reaction", "درد قفسه سینه", "تنگی نفس", "بیهوش", "غش", "تشنج", "خونریزی شدید", "حساسیت شدید"].some(term => termMatches(text, term))) {
      return { answer: fa
        ? `این نشانه‌ها گاهی به ارزیابی فوری نیاز دارند و من نمی‌توانم علت را از راه چت تشخیص دهم. اگر درد شدید قفسهٔ سینه، مشکل شدید تنفس، بیهوشی، تشنج یا واکنش حساسیتی همراه با مشکل تنفس اکنون رخ می‌دهد، همین حالا با اورژانس محل زندگی‌ات تماس بگیر. ${emergency.marker}`
        : `These symptoms can require urgent assessment, and I cannot determine the cause in chat. If severe chest pain, severe breathing trouble, fainting, a seizure, or an allergic reaction with breathing difficulty is happening now, call your local emergency service immediately. ${emergency.marker}`,
        sources: [emergency.source] };
    }
    const stroke = reference("https://www.cdc.gov/stroke/signs-symptoms/index.html");
    if (stroke && ["stroke", "one-sided weakness", "face droop", "slurred speech", "sudden weakness", "سکته مغزی", "کجی صورت", "ضعف یک طرف", "اختلال گفتار", "فلج ناگهانی"].some(term => termMatches(text, term))) {
      return { answer: fa
        ? `ضعف ناگهانی یک سمت بدن، مشکل ناگهانی در گفتار یا دید، یا سردرد شدید ناگهانی می‌تواند از نشانه‌های سکته باشد. اگر این نشانه‌ها اکنون وجود دارند، فوراً با اورژانس محل تماس بگیر؛ من نمی‌توانم این وضعیت را در چت تشخیص دهم. ${stroke.marker}`
        : `Sudden one-sided weakness, new speech or vision trouble, or an unexplained sudden severe headache can be stroke warning signs. If these are happening now, contact your local emergency service immediately; I cannot assess this in chat. ${stroke.marker}`,
        sources: [stroke.source] };
    }
  }
  if (slug === "skin-and-hair") {
    const lesion = reference("https://www.aad.org/public/diseases/skin-cancer");
    if (lesion && ["mole", "melanoma", "skin cancer", "changing spot", "bleeding spot", "skin lesion", "خال", "ملانوما", "سرطان پوست", "لکه پوستی", "ضایعه پوستی", "خال در حال تغییر", "لکه خونریزی"].some(term => termMatches(text, term))) {
      return { answer: fa
        ? `از روی عکس یا توضیح چت نمی‌توان سرطان پوست را تشخیص داد یا رد کرد. اگر خال یا لکه‌ای در حال تغییر، رشد یا خونریزی است، برای معاینه با متخصص پوست تماس بگیر؛ تشخیص قطعی ممکن است به نمونه‌برداری نیاز داشته باشد. ${lesion.marker}`
        : `A photo or chat description cannot diagnose or rule out skin cancer. If a spot or mole is changing, growing or bleeding, arrange an assessment with a dermatologist; diagnosis may require a biopsy. ${lesion.marker}`,
        sources: [lesion.source] };
    }
  }
  if (slug === "mental-wellbeing" && ["suicide", "self-harm", "kill myself", "want to die", "hurt myself", "ending my life", "خودکشی", "خودآزاری", "آسیب به خود", "می‌خواهم بمیرم", "میخوام بمیرم", "کشتن خودم", "مرگ خودم"].some(term => termMatches(text, term))) {
    const who = reference("https://www.who.int/news-room/fact-sheets/detail/depression");
    if (who) return { answer: fa
      ? `متأسفم که چنین فکری یا نگرانی‌ای پیش آمده. اگر خطر آسیب فوری وجود دارد، همین حالا با اورژانس یا خط بحران محل زندگی‌ات تماس بگیر و به فرد مورد اعتمادی در نزدیکی‌ات خبر بده. من نمی‌توانم جای کمک فوری حضوری را بگیرم. ${who.marker}`
      : `I'm sorry this concern has come up. If there is immediate danger of self-harm, contact your local emergency or crisis service now and tell someone you trust nearby. I cannot replace immediate in-person help. ${who.marker}`,
      sources: [who.source] };
  }
  return null;
}

function evidencePrompt(selected: readonly KnowledgeCard[]): string {
  const notes = selected.map((card, index) => `[S${index + 1}] ${card.title}\nURL: ${card.url}\n${card.origin === "medlineplus-snapshot" ? "Offline MedlinePlus.gov topic excerpt (2026-09-24 snapshot)" : "Reviewed note (checked 2026-09-25)"}: ${card.summary}`).join("\n\n");
  return `Use only the source notes below as evidence for factual health claims. These are bounded offline excerpts or paraphrases, not live page fetches, and do not establish an individual diagnosis. Cite each supported factual claim with its exact source marker [S1], [S2], or [S3] as appropriate; never invent a marker or URL. If these notes do not support the requested fact, say the evidence here is insufficient and recommend a qualified professional. Do not present a source as supporting a claim outside its note. Reply in the user's language. Keep the answer concise and supportive.\n\n${notes}`;
}

function citedSources(answer: string, selected: readonly KnowledgeCard[]): WebSearchAnswer["sources"] | null {
  if (/https?:\/\//i.test(answer)) return null;
  const markers = [...answer.matchAll(/\[S(\d+)\]/g)].map(match => Number(match[1]));
  if (!markers.length || markers.some(index => index < 1 || index > selected.length)) return null;
  return [...new Set(markers)].map(index => ({
    title: `[S${index}] ${selected[index - 1].title}`,
    url: selected[index - 1].url
  }));
}

export async function answerWithSpecialistKnowledge(request: {
  slug: string;
  query: string;
  priorUserText?: readonly string[];
  systemPrompt: string;
  messages: ChatMessage[];
  model: string;
  signal?: AbortSignal;
  siteUrl?: string;
  apiKey?: string;
  fetcher?: typeof fetch;
}): Promise<WebSearchAnswer> {
  if (isPersonalDoseQuestion(request.query)) return { answer: personalDoseFallback(request.query), sources: [] };
  const selected = retrieveSpecialistKnowledge(request.slug, request.query, request.priorUserText);
  if (!selected.length) return { answer: specialistFallback(request.slug, request.query), sources: [] };
  const urgent = urgentAnswer(request.slug, request.query, selected);
  if (urgent) return urgent;

  const response = await createChatCompletion({
    model: request.model, stream: false, signal: request.signal, siteUrl: request.siteUrl,
    apiKey: request.apiKey, fetcher: request.fetcher,
    messages: [{ role: "system", content: `${request.systemPrompt}\n\n${evidencePrompt(selected)}` }, ...request.messages]
  });
  let body: unknown;
  try { body = await response.json(); } catch { return { answer: unverifiedAnswerFallback(request.query), sources: [] }; }
  const root = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const choice = Array.isArray(root?.choices) ? root.choices[0] : null;
  const message = choice && typeof choice === "object" ? (choice as Record<string, unknown>).message : null;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;
  const answer = typeof content === "string" ? content.trim() : "";
  const sources = answer.length <= 200_000 ? citedSources(answer, selected) : null;
  return sources ? { answer, sources } : { answer: unverifiedAnswerFallback(request.query), sources: [] };
}
