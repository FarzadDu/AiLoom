import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { MediaTask } from "../src/server/media/service";

const directory = mkdtempSync(join(tmpdir(), "ailoom-worker-lease-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.MEDIA_DIR = join(directory, "media");

const { getDb, getSqlite } = await import("../src/server/db");
const { generationJob, user } = await import("../src/server/db/schema");
const { claimNextQueuedJob, createGenerationJob, getGenerationJob, transitionGenerationJob } =
  await import("../src/server/content/jobs");
const { createAsset, listAssets } = await import("../src/server/content/assets");
const { createProject, deleteProject } = await import("../src/server/content/projects");
const { mediaPath, savePrivateFile } = await import("../src/server/storage/private-files");
const { runMediaWorkerCycle } = await import("../src/server/media/worker");

migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
const ownerId = randomUUID();
const now = new Date();
getDb().insert(user).values({ id: ownerId, name: "Worker owner", email: "worker@example.test",
  role: "user", emailVerified: true, createdAt: now, updatedAt: now }).run();

after(() => {
  getSqlite().close();
  rmSync(directory, { recursive: true, force: true });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function newJob(prompt: string) {
  return createGenerationJob(ownerId, {
    kind: "image", provider: "fal", providerModel: "fal-ai/flux-2-pro",
    payload: { modelId: "fal-ai/flux-2-pro", operation: "text_to_image", prompt }
  });
}

test("another worker does not fail an in-flight paid submission", async () => {
  const job = newJob("Overlap during a deploy");
  const queueReference = "falq1:fal-task-one:fal-ai/flux-2-pro:response";
  const entered = deferred<void>();
  const accepted = deferred<{ provider: "fal"; modelId: string; operation: "text_to_image";
    providerTaskId: string; providerQueueReference?: string; state: "queued"; priceEstimate: null }>();
  let submitCount = 0;
  const first = runMediaWorkerCycle({
    submitMediaRequest: async () => { submitCount++; entered.resolve(); return accepted.promise; },
    getMediaTask: async reference => {
      assert.equal(reference.providerTaskId, queueReference);
      return { provider: "fal", modelId: "fal-ai/flux-2-pro",
        providerTaskId: "fal-task-one", state: "queued", assets: [], failureCode: null, progress: null };
    }
  });
  await entered.promise;
  assert.equal(getGenerationJob(ownerId, job.id)?.state, "submitting");

  await runMediaWorkerCycle({
    submitMediaRequest: async () => { throw new Error("A duplicate paid POST was attempted"); }
  });
  assert.equal(getGenerationJob(ownerId, job.id)?.state, "submitting");
  assert.equal(submitCount, 1);

  accepted.resolve({ provider: "fal", modelId: "fal-ai/flux-2-pro",
    operation: "text_to_image", providerTaskId: "fal-task-one",
    providerQueueReference: queueReference, state: "queued", priceEstimate: null });
  await first;
  assert.equal(getGenerationJob(ownerId, job.id)?.state, "running");
  assert.equal(getGenerationJob(ownerId, job.id)?.externalId, queueReference);
  transitionGenerationJob(ownerId, job.id, { state: "succeeded", output: { assets: [] } });
});

test("two workers cannot import the same completed output concurrently", async () => {
  const running = newJob("Completed output during a deploy");
  const submitting = claimNextQueuedJob(randomUUID());
  assert.equal(submitting?.id, running.id);
  transitionGenerationJob(ownerId, running.id, {
    state: "running", externalId: "fal-task-one", leaseOwner: submitting!.leaseOwner!
  });
  const entered = deferred<void>();
  const status = deferred<MediaTask>();
  let statusCalls = 0;
  let imports = 0;
  const first = runMediaWorkerCycle({
    getMediaTask: async () => { statusCalls++; entered.resolve(); return status.promise; },
    importProviderMedia: async () => {
      imports++;
      return savePrivateFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), "image/png");
    }
  });
  await entered.promise;

  await runMediaWorkerCycle({
    getMediaTask: async () => { throw new Error("A second worker polled an owned job"); },
    importProviderMedia: async () => { throw new Error("A second worker imported an owned output"); }
  });
  assert.equal(statusCalls, 1);
  assert.equal(imports, 0);

  status.resolve({ provider: "fal", modelId: "fal-ai/flux-2-pro",
    providerTaskId: "fal-task-one", state: "completed",
    assets: [{ kind: "image", url: "https://example.test/output.png", contentType: null }],
    failureCode: null, progress: null });
  await first;
  assert.equal(getGenerationJob(ownerId, running.id)?.state, "succeeded");
  assert.equal(imports, 1);
  assert.equal(listAssets(ownerId, { source: "generation" }).length, 1);
});

test("a completed media job saves its output in the same project", async () => {
  const project = createProject(ownerId, { name: "Campaign" });
  const job = createGenerationJob(ownerId, {
    kind: "image", provider: "fal", providerModel: "fal-ai/flux-2-pro",
    projectId: project.id,
    payload: { modelId: "fal-ai/flux-2-pro", operation: "text_to_image", prompt: "A blue thread" }
  });
  const submitting = claimNextQueuedJob(randomUUID());
  assert.equal(submitting?.id, job.id);
  transitionGenerationJob(ownerId, job.id, {
    state: "running", externalId: "fal-project-task", leaseOwner: submitting!.leaseOwner!
  });
  await runMediaWorkerCycle({
    getMediaTask: async () => ({ provider: "fal", modelId: "fal-ai/flux-2-pro",
      providerTaskId: "fal-project-task", state: "completed",
      assets: [{ kind: "image", url: "https://example.test/project.png", contentType: null }],
      failureCode: null, progress: null }),
    importProviderMedia: async () => savePrivateFile(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), "image/png")
  });
  assert.equal(getGenerationJob(ownerId, job.id)?.state, "succeeded");
  const outputId = (getGenerationJob(ownerId, job.id)?.output as {
    assets: Array<{ id: string }>
  }).assets[0].id;
  assert.equal(listAssets(ownerId, { source: "generation" })
    .find(asset => asset.id === outputId)?.projectId, project.id);
});

test("deleting a project during generation keeps the paid output in the library", async () => {
  const project = createProject(ownerId, { name: "Short-lived project" });
  const job = createGenerationJob(ownerId, {
    kind: "image", provider: "fal", providerModel: "fal-ai/flux-2-pro",
    projectId: project.id,
    payload: { modelId: "fal-ai/flux-2-pro", operation: "text_to_image", prompt: "An amber thread" }
  });
  const submitting = claimNextQueuedJob(randomUUID());
  assert.equal(submitting?.id, job.id);
  transitionGenerationJob(ownerId, job.id, {
    state: "running", externalId: "fal-deleted-project-task", leaseOwner: submitting!.leaseOwner!
  });
  const entered = deferred<void>();
  const status = deferred<MediaTask>();
  const worker = runMediaWorkerCycle({
    getMediaTask: async () => { entered.resolve(); return status.promise; },
    importProviderMedia: async () => savePrivateFile(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), "image/png")
  });
  await entered.promise;
  assert.equal(deleteProject(ownerId, project.id), true);
  status.resolve({ provider: "fal", modelId: "fal-ai/flux-2-pro",
    providerTaskId: "fal-deleted-project-task", state: "completed",
    assets: [{ kind: "image", url: "https://example.test/unassigned.png", contentType: null }],
    failureCode: null, progress: null });
  await worker;
  assert.equal(getGenerationJob(ownerId, job.id)?.state, "succeeded");
  const outputId = (getGenerationJob(ownerId, job.id)?.output as {
    assets: Array<{ id: string }>
  }).assets[0].id;
  assert.equal(listAssets(ownerId, { source: "generation" })
    .find(asset => asset.id === outputId)?.projectId, null);
});

test("video repair output inherits the source video's project", async () => {
  const project = createProject(ownerId, { name: "Video project" });
  const mp4 = Buffer.from([0, 0, 0, 8, 102, 116, 121, 112]);
  const sourceFile = await savePrivateFile(mp4, "video/mp4");
  const source = createAsset(ownerId, { ...sourceFile, source: "upload", projectId: project.id });
  const workDir = mediaPath(`repairs/${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });
  const job = createGenerationJob(ownerId, {
    kind: "edit", provider: "fal", providerModel: "fal-ai/ltx-2.3-quality/inpaint",
    payload: { request: { modelId: "fal-ai/ltx-2.3-quality/inpaint" },
      repair: { plan: { sourcePath: mediaPath(source.storageKey), workDir,
        targetStartSec: 10, targetEndSec: 12 },
      sourceAssetId: source.id, contextAssetIds: [] } }
  });
  const submitting = claimNextQueuedJob(randomUUID());
  assert.equal(submitting?.id, job.id);
  transitionGenerationJob(ownerId, job.id, {
    state: "running", externalId: "fal-repair-task", leaseOwner: submitting!.leaseOwner!
  });
  await runMediaWorkerCycle({
    getMediaTask: async () => ({ provider: "fal",
      modelId: "fal-ai/ltx-2.3-quality/inpaint", providerTaskId: "fal-repair-task",
      state: "completed", assets: [{ kind: "video", url: "https://example.test/repaired.mp4",
        contentType: null }], failureCode: null, progress: null }),
    importProviderMedia: async () => savePrivateFile(mp4, "video/mp4"),
    spliceTemporalRepair: async ({ outputPath }) => {
      writeFileSync(outputPath, mp4);
      return { outputPath, durationSec: 30, audioPreserved: false };
    }
  });
  assert.equal(getGenerationJob(ownerId, job.id)?.state, "succeeded");
  const outputId = (getGenerationJob(ownerId, job.id)?.output as {
    assets: Array<{ id: string }>
  }).assets[0].id;
  assert.equal(listAssets(ownerId, { source: "generation" })
    .find(asset => asset.id === outputId)?.projectId, project.id);
});

test("an expired submission is marked uncertain without another paid POST", async () => {
  const job = newJob("Lost response after worker exit");
  assert.equal(claimNextQueuedJob(randomUUID())?.id, job.id);
  getDb().update(generationJob).set({ leaseExpiresAt: new Date(0) })
    .where(eq(generationJob.id, job.id)).run();
  await runMediaWorkerCycle({
    submitMediaRequest: async () => { throw new Error("A duplicate paid POST was attempted"); }
  });
  const finished = getGenerationJob(ownerId, job.id);
  assert.equal(finished?.state, "failed");
  assert.equal(finished?.errorCode, "submission_uncertain");
});

test("an expired poll cannot publish its output after another worker takes over", async () => {
  const job = newJob("Recover interrupted output import");
  const existingAssetCount = listAssets(ownerId, { source: "generation" }).length;
  const submitting = claimNextQueuedJob(randomUUID());
  assert.equal(submitting?.id, job.id);
  transitionGenerationJob(ownerId, job.id, {
    state: "running", externalId: "fal-task-recovered", leaseOwner: submitting!.leaseOwner!
  });
  const entered = deferred<void>();
  const delayed = deferred<MediaTask>();
  let imports = 0;
  const fakeImport = async () => {
    imports++;
    return savePrivateFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), "image/png");
  };
  const first = runMediaWorkerCycle({
    getMediaTask: async () => { entered.resolve(); return delayed.promise; },
    importProviderMedia: fakeImport
  });
  await entered.promise;
  // Simulate a paused worker whose lease was not renewed.
  getDb().update(generationJob).set({ leaseExpiresAt: new Date(0) })
    .where(eq(generationJob.id, job.id)).run();
  const completedStatus = { provider: "fal" as const, modelId: "fal-ai/flux-2-pro",
    providerTaskId: "fal-task-recovered", state: "completed" as const,
    assets: [{ kind: "image" as const, url: "https://example.test/recovered.png", contentType: null }],
    failureCode: null, progress: null };
  await runMediaWorkerCycle({
    getMediaTask: async () => completedStatus,
    importProviderMedia: fakeImport
  });
  delayed.resolve(completedStatus);
  await first;
  assert.equal(getGenerationJob(ownerId, job.id)?.state, "succeeded");
  assert.equal(imports, 2, "both workers may download, but only the current lease may publish");
  assert.equal(listAssets(ownerId, { source: "generation" }).length, existingAssetCount + 1,
    "only the recovered output remains; the stale output was removed");
});
