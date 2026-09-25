import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrivateReferenceError, refreshPrivateAssetUrls } from "../src/server/media/private-references";
import { signedAssetUrl, verifyAssetAccess } from "../src/server/storage/asset-access";

test("queued private references are renewed only for owner-owned assets", () => {
  const oldBase = process.env.PUBLIC_BASE_URL;
  const oldSecret = process.env.BETTER_AUTH_SECRET;
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  process.env.BETTER_AUTH_SECRET = "test-only-secret-with-more-than-thirty-two-characters";
  try {
    const owner = randomUUID();
    const firstId = randomUUID();
    const lastId = randomUUID();
    const first = signedAssetUrl(firstId, 60).url;
    const last = signedAssetUrl(lastId, 60).url;
    const input = { modelId: "fal-ai/veo3.1/fast/first-last-frame-to-video",
      firstFrameUrl: first, lastFrameUrl: last, prompt: "A private scene",
      imageUrls: ["https://images.example.test/public.png", first] };
    const ownedIds = new Set<string>([firstId, lastId]);
    const owns = (userId: string, id: string) => userId === owner && ownedIds.has(id);
    const renewed = refreshPrivateAssetUrls(owner, input, owns) as typeof input;
    assert.equal(input.firstFrameUrl, first);
    assert.notEqual(renewed.firstFrameUrl, first);
    assert.notEqual(renewed.lastFrameUrl, last);
    assert.equal(renewed.imageUrls[0], input.imageUrls[0]);
    assert.equal(renewed.imageUrls[1], renewed.firstFrameUrl);
    for (const value of [renewed.firstFrameUrl, renewed.lastFrameUrl]) {
      const url = new URL(value);
      const id = url.pathname.split("/").at(-1)!;
      assert.equal(verifyAssetAccess(id, url.searchParams.get("expires"), url.searchParams.get("token")), true);
      assert.ok(Number(url.searchParams.get("expires")) - Math.floor(Date.now() / 1000) > 7100);
    }
    assert.throws(() => refreshPrivateAssetUrls(randomUUID(), input, owns), PrivateReferenceError);
    assert.throws(() => refreshPrivateAssetUrls(owner, { imageUrl: `https://ailoom.example.test/api/assets/${firstId}` }, owns), PrivateReferenceError);
  } finally {
    if (oldBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldBase;
    if (oldSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = oldSecret;
  }
});
