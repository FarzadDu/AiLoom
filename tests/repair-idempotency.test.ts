import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("repair replays the same paid job before source probing and rejects changed requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-repair-key-"));
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "repair-test-secret-must-have-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  const { getDb, getSqlite } = await import("../src/server/db");
  const { user } = await import("../src/server/db/schema");
  const { createInvite } = await import("../src/server/auth/invites");
  const { createProject } = await import("../src/server/content/projects");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const repairRoute = await import("../src/app/api/video/repair/route");
  const { createGenerationJob, GenerationIdempotencyConflictError } = await import("../src/server/content/jobs");

  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const invitation = createInvite({ email: "repair@example.test" });
    const signup = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Repair Tester", email: "repair@example.test",
        password: "Repair-test-password-123!", inviteToken: invitation.token })
    }));
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const signupData = await signup.json();
    const ownerId = signupData.user.id as string;
    const project = createProject(ownerId, { name: "Repair project" });
    const foreignOwnerId = randomUUID();
    const now = new Date();
    getDb().insert(user).values({ id: foreignOwnerId, name: "Other", email: "repair-other@example.test",
      role: "user", emailVerified: true, createdAt: now, updatedAt: now }).run();
    const foreignProject = createProject(foreignOwnerId, { name: "Private project" });
    const key = randomUUID();
    const originalRequest = {
      sourceAssetId: randomUUID(), startSec: 10, endSec: 12, prompt: "Replace the cup"
    };
    const interval = { targetStartSec: 10, targetEndSec: 12,
      contextStartSec: 9.25, contextEndSec: 12.75 };
    const jobInput = {
      kind: "edit" as const, provider: "fal",
      providerModel: "fal-ai/ltx-2.3-quality/inpaint",
      idempotencyKey: key,
      payload: { request: { modelId: "fal-ai/ltx-2.3-quality/inpaint" },
        repair: { originalRequest, sourceAssetId: originalRequest.sourceAssetId,
          plan: interval, contextAssetIds: [] } }
    };
    const existing = createGenerationJob(ownerId, jobInput);
    const send = (input: unknown, requestKey: string = key) => repairRoute.POST(new Request(
      "http://localhost:3000/api/video/repair", {
        method: "POST", headers: { origin: "http://localhost:3000", cookie,
          "content-type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify(input)
      }
    ));

    // There is deliberately no source video on disk or in the asset table.
    // A replay must return before any FFmpeg, signed-URL or asset operation.
    const replay = await send(originalRequest);
    assert.equal(replay.status, 202);
    const replayBody = await replay.json();
    assert.equal(replayBody.job.id, existing.id);
    assert.deepEqual(replayBody.interval, {
      startSec: 10, endSec: 12, contextStartSec: 9.25, contextEndSec: 12.75
    });
    assert.equal((await send({ ...originalRequest, prompt: "Replace the plate" })).status, 409);
    assert.equal((await send({ ...originalRequest, startSec: 9 })).status, 409);
    assert.equal((await send(originalRequest, "not-a-uuid")).status, 400);
    assert.equal((await send(originalRequest, randomUUID())).status, 404);
    assert.equal((await send({ ...originalRequest, prompt: "x".repeat(20_000) })).status, 413);

    const projectKey = randomUUID();
    const projectRequest = { ...originalRequest, projectId: project.id };
    const projectJob = createGenerationJob(ownerId, {
      ...jobInput, idempotencyKey: projectKey, projectId: project.id,
      payload: { ...jobInput.payload, repair: { ...jobInput.payload.repair,
        originalRequest: projectRequest } }
    });
    assert.equal((await send(projectRequest, projectKey)).status, 202);
    assert.equal(projectJob.projectId, project.id);
    assert.equal((await send({ ...projectRequest, projectId: null }, projectKey)).status, 409);
    assert.equal((await send({ ...projectRequest, projectId: "invalid" }, randomUUID())).status, 400);
    assert.equal((await send({ ...projectRequest, projectId: foreignProject.id }, randomUUID())).status, 404);

    // A simultaneous preprocessing attempt would produce a different plan and
    // fail at the unique job key. The route's conflict handler replays this job.
    assert.throws(() => createGenerationJob(ownerId, {
      ...jobInput, payload: { ...jobInput.payload,
        repair: { ...jobInput.payload.repair, plan: { ...interval, contextStartSec: 9 } } }
    }), GenerationIdempotencyConflictError);
    assert.equal((await send(originalRequest)).status, 202);
  } finally {
    getSqlite().close();
    const within = relative(resolve(tmpdir()), resolve(directory));
    if (within && !within.startsWith("..") && !within.includes(":")) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
