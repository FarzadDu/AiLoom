import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("generic generations save an owned project without forwarding it to providers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-generation-project-"));
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL
  };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.BETTER_AUTH_SECRET = "generation-project-test-secret-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  const { getDb, getSqlite } = await import("../src/server/db");
  const { user } = await import("../src/server/db/schema");
  const { createInvite } = await import("../src/server/auth/invites");
  const { createProject } = await import("../src/server/content/projects");
  const { getGenerationJob } = await import("../src/server/content/jobs");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const generationsRoute = await import("../src/app/api/generations/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const invite = createInvite({ email: "studio-project@example.test" });
    const signup = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Studio Project Tester", email: "studio-project@example.test",
        password: "Studio-project-test-password-123!", inviteToken: invite.token })
    }));
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const ownerId = (await signup.json()).user.id as string;
    const project = createProject(ownerId, { name: "Editorial" });
    const foreignOwnerId = randomUUID();
    const now = new Date();
    getDb().insert(user).values({ id: foreignOwnerId, name: "Other", email: "studio-other@example.test",
      role: "user", emailVerified: true, createdAt: now, updatedAt: now }).run();
    const foreignProject = createProject(foreignOwnerId, { name: "Private" });
    const mediaInput = { modelId: "wavespeed-ai/z-image/turbo", operation: "text_to_image",
      prompt: "A cobalt paper lantern" };
    const send = (body: unknown, key = randomUUID()) => generationsRoute.POST(
      new Request("http://localhost:3000/api/generations", {
        method: "POST", headers: { origin: "http://localhost:3000", cookie,
          "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body)
      }));

    assert.equal((await send({ ...mediaInput, projectId: "not-a-uuid" })).status, 400);
    assert.equal((await send({ ...mediaInput, projectId: foreignProject.id })).status, 404);
    const key = randomUUID();
    const first = await send({ ...mediaInput, projectId: project.id }, key);
    assert.equal(first.status, 202);
    assert.equal((await first.json()).job.id, key);
    assert.equal(getGenerationJob(ownerId, key)?.projectId, project.id);
    assert.deepEqual(getGenerationJob(ownerId, key)?.input, mediaInput);
    assert.equal((await send({ ...mediaInput, projectId: project.id }, key)).status, 202);
    assert.equal((await send({ ...mediaInput, projectId: null }, key)).status, 409);

    const unassignedKey = randomUUID();
    assert.equal((await send(mediaInput, unassignedKey)).status, 202);
    assert.equal(getGenerationJob(ownerId, unassignedKey)?.projectId, null);
  } finally {
    getSqlite().close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (resolve(directory).startsWith(resolve(tmpdir()) + "\\") &&
      basename(directory).startsWith("ailoom-generation-project-")) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
