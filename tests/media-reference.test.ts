import assert from "node:assert/strict";
import { test } from "node:test";
import { retainImageReferenceOnModeChange, usableReference } from "../src/components/media-reference";

test("an owned generated image is reusable without another local upload", () => {
  const reference = { assetId: "asset-one", mime: "image/png" };
  assert.equal(usableReference(reference, ["image/png", "image/jpeg"], 8_000_000), true);
  assert.equal(usableReference(reference, ["video/mp4"]), false);
  assert.equal(usableReference({ mime: "image/png" }, ["image/png"]), false);
});

test("a local source still obeys file type and size limits", () => {
  const allowed = ["image/png", "image/jpeg"];
  assert.equal(usableReference({ mime: "image/png", file: { type: "image/png", size: 8_000_000 } }, allowed, 8_000_000), true);
  assert.equal(usableReference({ mime: "image/png", file: { type: "image/png", size: 8_000_001 } }, allowed, 8_000_000), false);
  assert.equal(usableReference({ mime: "image/png", file: { type: "image/webp", size: 200 } }, allowed, 8_000_000), false);
});

test("switching between image edit tools retains a loaded reference", () => {
  const reference = { assetId: "asset-one", mime: "image/png" };
  assert.equal(retainImageReferenceOnModeChange("image", 3, reference), true);
  assert.equal(retainImageReferenceOnModeChange("image", 0, reference), false);
  assert.equal(retainImageReferenceOnModeChange("video", 3, reference), true);
  assert.equal(retainImageReferenceOnModeChange("video", 1, reference), true);
  assert.equal(retainImageReferenceOnModeChange("video", 2, reference), false);
});
