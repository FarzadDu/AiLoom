import assert from "node:assert/strict";
import { test } from "node:test";
import { usableInpaintMask } from "../src/components/inpaint-canvas";

test("uploaded inpaint masks must be valid PNGs matching the source dimensions", () => {
  const source = { width: 1024, height: 768 };
  const matching = { width: 1024, height: 768 };
  assert.equal(usableInpaintMask({ type: "image/png", size: 512_000 }, source, matching), true);
  assert.equal(usableInpaintMask({ type: "image/jpeg", size: 512_000 }, source, matching), false);
  assert.equal(usableInpaintMask({ type: "image/png", size: 0 }, source, matching), false);
  assert.equal(usableInpaintMask({ type: "image/png", size: 8_000_001 }, source, matching), false);
  assert.equal(usableInpaintMask({ type: "image/png", size: 512_000 }, source,
    { width: 1023, height: 768 }), false);
});
