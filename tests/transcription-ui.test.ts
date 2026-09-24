import assert from "node:assert/strict";
import test from "node:test";
import { speakerTurns, transcriptDownloadName, transcriptFromPayload } from "../src/components/transcription-ui";

test("transcription response keeps text, language and speaker timestamps", () => {
  const transcript = transcriptFromPayload({
    text: "Hello, world. سلام",
    languageCode: "en",
    words: [
      { text: "Hello", start: 0, end: 0.3, speakerId: "speaker_0" },
      { text: ",", start: 0.3, end: 0.4, speakerId: "speaker_0" },
      { text: "world.", start: 0.4, end: 0.8, speakerId: "speaker_0" },
      { text: "سلام", start: 1, end: 1.4, speakerId: "speaker_1" }
    ]
  });
  assert.ok(transcript);
  assert.equal(transcript.text, "Hello, world. سلام");
  assert.equal(transcript.languageCode, "en");
  assert.deepEqual(speakerTurns(transcript.words), [
    { speakerId: "speaker_0", text: "Hello, world.", start: 0 },
    { speakerId: "speaker_1", text: "سلام", start: 1 }
  ]);
});

test("invalid response is rejected and transcript downloads use a safe filename", () => {
  assert.equal(transcriptFromPayload({ words: [] }), null);
  assert.equal(transcriptDownloadName("interview.mp3"), "interview.txt");
  assert.equal(transcriptDownloadName("bad/name.webm"), "bad_name.txt");
});
