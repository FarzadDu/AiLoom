import assert from "node:assert/strict";
import { test } from "node:test";
import { audioPriceNote } from "../src/components/audio-price-note";

test("music price notes use the selected interface language", () => {
  const providerNote = "Published rate is $0.60 per started output minute; final charge may vary by account.";
  assert.equal(audioPriceNote("en", "elevenlabs/music/v2", providerNote), providerNote);
  for (const id of ["elevenlabs/music/v2", "elevenlabs/music/v2.5"]) {
    const localized = audioPriceNote("fa", id, providerNote);
    assert.match(localized, /۰٫۶۰ دلار/);
    assert.doesNotMatch(localized, /Published rate/);
  }
});

test("both Stable Audio music sizes use a Persian price caveat", () => {
  for (const id of [
    "fal-ai/stable-audio-3/small/music/text-to-audio",
    "fal-ai/stable-audio-3/medium/text-to-audio"
  ]) {
    const localized = audioPriceNote("fa", id, "Fal displays a sample per-audio price.");
    assert.match(localized, /هزینهٔ Stable Audio 3 Music/);
  }
});

test("unknown pricing never renders an English provider note in Persian mode", () => {
  assert.equal(audioPriceNote("fa", "future-music-model", "Provider-only English note"),
    "قیمت نهایی به ارائه‌دهنده بستگی دارد.");
  assert.equal(audioPriceNote("en", "future-music-model"), "Live price depends on the provider.");
});
