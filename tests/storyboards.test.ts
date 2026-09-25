import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { after, test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const directory = mkdtempSync(join(tmpdir(), "ailoom-storyboard-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.BETTER_AUTH_SECRET = "storyboard-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.PUBLIC_BASE_URL = "http://localhost:3000";

const { getDb, getSqlite } = await import("../src/server/db");
const { user, storyboardShot } = await import("../src/server/db/schema");
const boards = await import("../src/server/content/storyboards");
const assets = await import("../src/server/content/assets");
const projects = await import("../src/server/content/projects");
const { createInvite } = await import("../src/server/auth/invites");
const authRoute = await import("../src/app/api/auth/[...all]/route");
const boardCollectionRoute = await import("../src/app/api/storyboards/route");
const boardItemRoute = await import("../src/app/api/storyboards/[id]/route");
const shotCollectionRoute = await import("../src/app/api/storyboards/[id]/shots/route");
const shotItemRoute = await import("../src/app/api/storyboards/[id]/shots/[shotId]/route");
const reorderRoute = await import("../src/app/api/storyboards/[id]/shots/reorder/route");

migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
const alice = randomUUID();
const bob = randomUUID();
const now = new Date();
getDb().insert(user).values([
  { id: alice, name: "Alice", email: "board-alice@example.test", createdAt: now, updatedAt: now },
  { id: bob, name: "Bob", email: "board-bob@example.test", createdAt: now, updatedAt: now }
]).run();

after(() => {
  getSqlite().close();
  const within = relative(resolve(tmpdir()), resolve(directory));
  if (within && !within.startsWith("..") && !within.includes(":")) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createAsset(ownerId: string, kind: "image" | "video" | "audio" | "file") {
  const mimeType = { image: "image/png", video: "video/mp4",
    audio: "audio/mpeg", file: "application/pdf" }[kind];
  return assets.createAsset(ownerId, { kind, source: "upload", mimeType,
    sizeBytes: 10, storageKey: `uploads/${randomUUID()}` });
}

const baseShot = {
  title: "Opening shot", prompt: "A glass sphere on a table, slow dolly in",
  modelId: "fal-ai/veo3.1/fast", durationSec: 4, aspectRatio: "16:9" as const
};

test("storyboards and their project binding remain owner-scoped", () => {
  const aliceProject = projects.createProject(alice, { name: "Film" });
  assert.throws(() => boards.createStoryboard(bob,
    { title: "Intrusion", projectId: aliceProject.id }),
  (error: unknown) => error instanceof boards.StoryboardError && error.status === 404);
  const board = boards.createStoryboard(alice,
    { title: "Glass story", projectId: aliceProject.id });
  assert.equal(board.projectId, aliceProject.id);
  assert.deepEqual(boards.listStoryboards(bob), []);
  assert.equal(boards.getStoryboard(bob, board.id), null);
  assert.equal(boards.updateStoryboard(bob, board.id, { title: "Stolen" }), null);
  assert.equal(boards.deleteStoryboard(bob, board.id), false);
  assert.equal(boards.updateStoryboard(alice, board.id, { description: "Three scenes" })?.description,
    "Three scenes");
  assert.equal(boards.getStoryboard(alice, board.id)?.shots?.length, 0);
  assert.equal(boards.deleteStoryboard(alice, board.id), true);
  assert.equal(boards.getStoryboard(alice, board.id), null);
});

test("shots validate model controls, private asset ownership and media types", () => {
  const board = boards.createStoryboard(alice, { title: "Reference film" });
  const image = createAsset(alice, "image");
  const audio = createAsset(alice, "audio");
  const video = createAsset(alice, "video");
  const pdf = createAsset(alice, "file");
  const foreignImage = createAsset(bob, "image");
  assets.setAssetVisibility(bob, foreignImage.id, "public");
  const shot = boards.createStoryboardShot(alice, board.id, {
    ...baseShot, firstFrameAssetId: image.id,
    referenceAssetIds: [image.id, audio.id], outputAssetId: video.id
  });
  assert.ok(shot);
  assert.deepEqual(shot.referenceAssetIds, [image.id, audio.id]);
  assert.equal(shot.outputAssetId, video.id);
  assert.equal(boards.getStoryboardShot(bob, board.id, shot.id), null);
  assert.equal(boards.updateStoryboardShot(bob, board.id, shot.id, { title: "Stolen" }), null);
  assert.equal(boards.deleteStoryboardShot(bob, board.id, shot.id), false);
  assert.throws(() => boards.createStoryboardShot(alice, board.id,
    { ...baseShot, firstFrameAssetId: foreignImage.id }), boards.StoryboardError);
  assert.throws(() => boards.updateStoryboardShot(alice, board.id, shot.id,
    { referenceAssetIds: [foreignImage.id] }), boards.StoryboardError);
  assert.throws(() => boards.updateStoryboardShot(alice, board.id, shot.id,
    { referenceAssetIds: [pdf.id] }), boards.StoryboardError);
  assert.throws(() => boards.updateStoryboardShot(alice, board.id, shot.id,
    { outputAssetId: image.id }), boards.StoryboardError);
  assert.throws(() => boards.createStoryboardShot(alice, board.id,
    { ...baseShot, modelId: "fal-ai/flux-2-pro" }), boards.StoryboardError);
  assert.throws(() => boards.createStoryboardShot(alice, board.id,
    { ...baseShot, durationSec: 5 }), boards.StoryboardError);
  assert.equal(boards.getStoryboardShot(alice, board.id, shot.id)?.title, "Opening shot");
  assert.equal(boards.updateStoryboardShot(alice, board.id, shot.id,
    { title: "Close-up", outputAssetId: null })?.outputAssetId, null);
  assert.equal(boards.getStoryboardShot(alice, board.id, shot.id)?.title, "Close-up");
});

test("ordered shots swap, reject incomplete orders and compact on deletion", () => {
  const board = boards.createStoryboard(alice, { title: "Three cuts" });
  const shots = ["A", "B", "C"].map(title => boards.createStoryboardShot(alice, board.id,
    { ...baseShot, title }));
  assert.deepEqual(shots.map(shot => shot?.position), [0, 1, 2]);
  const requested = [shots[2]!.id, shots[0]!.id, shots[1]!.id];
  assert.deepEqual(boards.reorderStoryboardShots(alice, board.id, { shotIds: requested })?.map(shot => shot.id), requested);
  assert.throws(() => boards.reorderStoryboardShots(alice, board.id,
    { shotIds: requested.slice(0, 2) }), boards.StoryboardError);
  assert.throws(() => boards.reorderStoryboardShots(alice, board.id,
    { shotIds: [requested[0], requested[0], requested[1]] }));
  assert.equal(boards.reorderStoryboardShots(bob, board.id, { shotIds: requested }), null);
  assert.deepEqual(boards.listStoryboardShots(alice, board.id)?.map(shot => shot.id), requested);
  assert.equal(boards.deleteStoryboardShot(alice, board.id, requested[1]), true);
  assert.deepEqual(boards.listStoryboardShots(alice, board.id)?.map(shot => shot.position), [0, 1]);
  const appended = boards.createStoryboardShot(alice, board.id, { ...baseShot, title: "D" });
  assert.equal(appended?.position, 2);
  assert.throws(() => getDb().insert(storyboardShot).values({
    id: randomUUID(), storyboardId: board.id, ownerId: bob, position: 3,
    title: "Illegal", prompt: "bad", modelId: baseShot.modelId,
    durationSec: 4, aspectRatio: "16:9", createdAt: now, updatedAt: now
  }).run());
  assert.equal(boards.deleteStoryboard(alice, board.id), true);
  assert.equal(boards.listStoryboardShots(alice, board.id), null);
});

test("storyboard API requires a session, same-origin mutation and bounded private payloads", async () => {
  const base = "http://localhost:3000";
  const collection = `${base}/api/storyboards`;
  const unauthenticated = new Request(collection);
  assert.equal((await boardCollectionRoute.GET(unauthenticated)).status, 401);
  assert.equal((await boardCollectionRoute.POST(new Request(collection, {
    method: "POST", headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ title: "No session" })
  }))).status, 401);

  const invite = createInvite({ email: "board-route@example.test" });
  const signup = await authRoute.POST(new Request(`${base}/api/auth/sign-up/email`, {
    method: "POST", headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ name: "Route Tester", email: "board-route@example.test",
      password: "Route-test-password-123!", inviteToken: invite.token })
  }));
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const request = (url: string, method: string, body?: unknown, origin = base) => new Request(url, {
    method, headers: { origin, cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  assert.equal((await boardCollectionRoute.POST(request(collection, "POST",
    { title: "Wrong origin" }, "https://evil.example"))).status, 403);
  assert.equal((await boardCollectionRoute.POST(request(collection, "POST",
    { title: "x".repeat(20_000) }))).status, 413);
  const created = await boardCollectionRoute.POST(request(collection, "POST", { title: "Private route film" }));
  assert.equal(created.status, 201);
  const boardId = (await created.json()).storyboard.id as string;
  assert.equal(created.headers.get("cache-control"), "private, no-store");
  const item = `${collection}/${boardId}`;
  const shotCollection = `${item}/shots`;
  const added = await shotCollectionRoute.POST(request(shotCollection, "POST", baseShot),
    { params: Promise.resolve({ id: boardId }) });
  assert.equal(added.status, 201);
  const shotId = (await added.json()).shot.id as string;
  assert.equal((await shotCollectionRoute.POST(request(shotCollection, "POST",
    { ...baseShot, referenceAssetIds: [createAsset(bob, "image").id] }),
    { params: Promise.resolve({ id: boardId }) })).status, 400);
  assert.equal((await boardItemRoute.GET(request(item, "GET"),
    { params: Promise.resolve({ id: boardId }) })).status, 200);
  assert.equal((await shotItemRoute.GET(request(`${shotCollection}/${shotId}`, "GET"),
    { params: Promise.resolve({ id: boardId, shotId }) })).status, 200);
  assert.equal((await reorderRoute.PATCH(request(`${shotCollection}/reorder`, "PATCH", { shotIds: [shotId] }),
    { params: Promise.resolve({ id: boardId }) })).status, 200);
  assert.equal((await boardCollectionRoute.GET(request(collection, "GET"))).status, 200);
  assert.equal((await boardCollectionRoute.GET(request(`${collection}?limit=bogus`, "GET"))).status, 400);

  const foreignInvite = createInvite({ email: "board-route-foreign@example.test" });
  const foreignSignup = await authRoute.POST(new Request(`${base}/api/auth/sign-up/email`, {
    method: "POST", headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ name: "Foreign Tester", email: "board-route-foreign@example.test",
      password: "Foreign-test-password-123!", inviteToken: foreignInvite.token })
  }));
  assert.equal(foreignSignup.status, 200);
  const foreignCookie = foreignSignup.headers.get("set-cookie")?.split(";")[0];
  assert.ok(foreignCookie);
  const foreignGet = new Request(item, { headers: { cookie: foreignCookie } });
  assert.equal((await boardItemRoute.GET(foreignGet,
    { params: Promise.resolve({ id: boardId }) })).status, 404);
  const foreignDelete = new Request(item, { method: "DELETE",
    headers: { origin: base, cookie: foreignCookie } });
  assert.equal((await boardItemRoute.DELETE(foreignDelete,
    { params: Promise.resolve({ id: boardId }) })).status, 404);
  assert.equal((await shotItemRoute.GET(new Request(`${shotCollection}/${shotId}`,
    { headers: { cookie: foreignCookie } }),
    { params: Promise.resolve({ id: boardId, shotId }) })).status, 404);

  assert.equal((await boardItemRoute.DELETE(request(item, "DELETE"),
    { params: Promise.resolve({ id: boardId }) })).status, 204);
  assert.equal((await boardItemRoute.GET(request(item, "GET"),
    { params: Promise.resolve({ id: boardId }) })).status, 404);
});
