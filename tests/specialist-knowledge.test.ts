import assert from "node:assert/strict";
import test from "node:test";
import { answerWithSpecialistKnowledge, retrieveSpecialistKnowledge } from "../src/server/chat/specialist-knowledge";
import medlinePlus from "../src/server/chat/medlineplus-topics.json";

const request = {
  systemPrompt: "Give careful, bounded health information.",
  model: "example/model",
  apiKey: "test-only-key"
};

test("retrieval stays in the selected specialist and handles English and Persian", () => {
  const english = retrieveSpecialistKnowledge("skin-and-hair", "What does my acne mean?");
  assert.equal(english.length, 1);
  assert.equal(english[0].url, "https://www.aad.org/public/diseases/acne/derm-treat/treat");
  const persian = retrieveSpecialistKnowledge("skin-and-hair", "ریزش مو دارم");
  assert.equal(persian.length, 1);
  assert.match(persian[0].title, /Hair loss/);
  assert.deepEqual(retrieveSpecialistKnowledge("general-health", "Does acne need care?"), []);
  assert.deepEqual(retrieveSpecialistKnowledge("mental-wellbeing", "Please diagnose my eczema"), []);
});

test("a short follow-up uses only the most recent previous user topic", () => {
  const sources = retrieveSpecialistKnowledge("mental-wellbeing", "What else can I do?", ["I have anxiety", "I've been under stress"]);
  assert.equal(sources.length, 1);
  assert.match(sources[0].title, /Stress/);
});

test("the offline MedlinePlus snapshot is attributed and broad without leaking across specialists", () => {
  assert.equal(medlinePlus.snapshotDate, "2026-09-24");
  assert.match(medlinePlus.attribution, /MedlinePlus\.gov.*National Library of Medicine/);
  assert.equal(medlinePlus.topics.length, 1017);
  assert.ok(medlinePlus.topics.every(topic => topic.url.startsWith("https://medlineplus.gov/")
    && topic.title && topic.summary && topic.groups.length));

  const pressure = retrieveSpecialistKnowledge("general-health", "What should I know about high blood pressure?");
  assert.equal(pressure[0].title, "MedlinePlus — High Blood Pressure");
  assert.ok(pressure.every(source => !/Low Blood Pressure/.test(source.title)));
  assert.equal(retrieveSpecialistKnowledge("skin-and-hair", "Could this be eczema?")[0].title,
    "MedlinePlus — Eczema");
  assert.equal(retrieveSpecialistKnowledge("mental-wellbeing", "Tell me about bipolar disorder")[0].title,
    "MedlinePlus — Bipolar Disorder");
  assert.deepEqual(retrieveSpecialistKnowledge("general-health", "Could this be eczema?"), []);
  assert.deepEqual(retrieveSpecialistKnowledge("mental-wellbeing", "Could this be eczema?"), []);
  assert.deepEqual(retrieveSpecialistKnowledge("skin-and-hair", "Is this bipolar disorder?"), []);
  assert.deepEqual(retrieveSpecialistKnowledge("general-health", "Why is my car engine noisy?"), []);
});

test("common Persian terms map to the offline topics without translating or calling a provider", () => {
  assert.equal(retrieveSpecialistKnowledge("general-health", "فشار خون بالا یعنی چی؟")[0].title,
    "MedlinePlus — High Blood Pressure");
  assert.equal(retrieveSpecialistKnowledge("skin-and-hair", "پسوریازیس دارم")[0].title,
    "MedlinePlus — Psoriasis");
  assert.equal(retrieveSpecialistKnowledge("mental-wellbeing", "اختلال دوقطبی چیست؟")[0].title,
    "MedlinePlus — Bipolar Disorder");
});

test("a personal dose request never calls the model or invents a sourced recommendation", async () => {
  let calls = 0;
  const answer = await answerWithSpecialistKnowledge({
    ...request, slug: "general-health", query: "What is the ideal magnesium dose for my condition?",
    messages: [{ role: "user", content: "What is the ideal magnesium dose for my condition?" }],
    fetcher: async () => { calls += 1; throw new Error("Provider must not be called"); }
  });
  assert.equal(calls, 0);
  assert.deepEqual(answer.sources, []);
  assert.match(answer.answer, /cannot establish a safe dose/i);
});

test("an offline topic sends only its bounded excerpt to the model and validates citation markers", async () => {
  let prompt = "";
  const answer = await answerWithSpecialistKnowledge({
    ...request, slug: "general-health", query: "What is high blood pressure?",
    messages: [{ role: "user", content: "What is high blood pressure?" }],
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      prompt = body.messages[0].content;
      return Response.json({ choices: [{ message: { content: "Blood pressure is the force of blood against artery walls. [S1]" } }] });
    }
  });
  assert.match(prompt, /Offline MedlinePlus\.gov topic excerpt \(2026-09-24 snapshot\)/);
  assert.match(prompt, /MedlinePlus — High Blood Pressure/);
  assert.doesNotMatch(prompt, /MedlinePlus — Low Blood Pressure/);
  assert.equal(answer.sources[0].url, "https://medlineplus.gov/highbloodpressure.html");
});

test("urgent chest symptoms and Persian self-harm concern use deterministic sourced guidance", async () => {
  const forbidden = async () => { throw new Error("Provider must not be called for urgent guidance"); };
  const chest = await answerWithSpecialistKnowledge({
    ...request, slug: "general-health", query: "I have severe chest pain now",
    messages: [{ role: "user", content: "I have severe chest pain now" }], fetcher: forbidden
  });
  assert.match(chest.answer, /local emergency service immediately/);
  assert.match(chest.answer, /\[S1\]/);
  assert.equal(chest.sources[0].url, "https://medlineplus.gov/ency/patientinstructions/000593.htm");
  const crisis = await answerWithSpecialistKnowledge({
    ...request, slug: "mental-wellbeing", query: "میخوام بمیرم",
    messages: [{ role: "user", content: "میخوام بمیرم" }], fetcher: forbidden
  });
  assert.match(crisis.answer, /اورژانس یا خط بحران/);
  assert.equal(crisis.sources.length, 1);
  assert.equal(crisis.sources[0].url, "https://www.who.int/news-room/fact-sheets/detail/depression");
  const lesion = await answerWithSpecialistKnowledge({
    ...request, slug: "skin-and-hair", query: "Can you diagnose this changing mole from a photo?",
    messages: [{ role: "user", content: "Can you diagnose this changing mole from a photo?" }], fetcher: forbidden
  });
  assert.match(lesion.answer, /cannot diagnose or rule out/);
  assert.equal(lesion.sources[0].url, "https://www.aad.org/public/diseases/skin-cancer");
});

test("specialist answer only exposes retrieved URLs referenced by valid markers", async () => {
  const providerRequest: { current: Record<string, unknown> | null } = { current: null };
  const fetcher: typeof fetch = async (_url, init) => {
    providerRequest.current = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "Acne-like bumps can have different causes; a dermatologist can assess them. [S1]" } }] });
  };
  const answer = await answerWithSpecialistKnowledge({
    ...request, slug: "skin-and-hair", query: "Is this acne?",
    messages: [{ role: "user", content: "Is this acne?" }], fetcher
  });
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].url, "https://www.aad.org/public/diseases/acne/derm-treat/treat");
  assert.equal(providerRequest.current?.stream, false);
  const messages = providerRequest.current?.messages as Array<{ role: string; content: string }>;
  assert.match(messages[0].content, /\[S1\] American Academy of Dermatology/);
  assert.doesNotMatch(messages[0].content, /WHO — Depressive disorder/);
});

test("unsupported or fabricated model citations are suppressed", async () => {
  for (const content of ["Your dose is 100 mg. [S9]", "Read https://invented.invalid for the answer. [S1]", "This is certainly a diagnosis."]) {
    const answer = await answerWithSpecialistKnowledge({
      ...request, slug: "skin-and-hair", query: "I have acne",
      messages: [{ role: "user", content: "I have acne" }],
      fetcher: async () => Response.json({ choices: [{ message: { content } }] })
    });
    assert.deepEqual(answer.sources, []);
    assert.match(answer.answer, /could not verify the generated answer/i);
    assert.doesNotMatch(answer.answer, /100 mg|invented\.invalid|certainly a diagnosis/);
  }
});
