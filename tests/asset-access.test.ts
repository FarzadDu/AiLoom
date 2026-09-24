import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { signedAssetUrl, verifyAssetAccess } from "../src/server/storage/asset-access";

test("private media capability is scoped to one asset and expires", () => {
  const oldBase = process.env.PUBLIC_BASE_URL;
  const oldSecret = process.env.BETTER_AUTH_SECRET;
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  process.env.BETTER_AUTH_SECRET = "test-only-secret-with-more-than-thirty-two-characters";
  try {
    const id = randomUUID();
    const access = signedAssetUrl(id, 60);
    const url = new URL(access.url);
    const expires = url.searchParams.get("expires");
    const token = url.searchParams.get("token");
    assert.equal(verifyAssetAccess(id, expires, token), true);
    assert.equal(verifyAssetAccess(randomUUID(), expires, token), false);
    assert.equal(verifyAssetAccess(id, "1000000000", token), false);
    assert.equal(verifyAssetAccess(id, expires, "a".repeat(43)), false);
  } finally {
    if (oldBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldBase;
    if (oldSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = oldSecret;
  }
});
