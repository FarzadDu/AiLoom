import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { WaveSpeedError, type WaveSpeedTask } from "../src/server/providers/wavespeed";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");

function crc32(bytes: Buffer): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}

function datasetZip(): Buffer {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let position = 0;
  for (let i = 0; i < 4; i++) {
    const name = Buffer.from(`photo-${i}.png`);
    const data = PNG;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    local.push(head, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(position, 42);
    directory.push(central, name);
    position += head.length + name.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(4, 8); end.writeUInt16LE(4, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(position, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}

function providerTask(id: string, model: string, state: "queued" | "completed", url?: string): WaveSpeedTask {
  return { predictionId: id, model, state, providerStatus: state === "completed" ? "completed" : "created",
    outputs: url ? [{ kind: "media", url, contentType: null }] : [], inferenceMs: null };
}

function tinySafetensors(): Buffer {
  const header = Buffer.from(JSON.stringify({ test: { dtype: "F32", shape: [1], data_offsets: [0, 4] } }));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, header, Buffer.alloc(4)]);
}

test("private LoRA ZIP upload, owner isolation, idempotent queues and independent worker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-lora-"));
  const previous = { DATABASE_PATH: process.env.DATABASE_PATH, MEDIA_DIR: process.env.MEDIA_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "lora-test-secret-with-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  const { getDb, getSqlite } = await import("../src/server/db");
  const { createInvite } = await import("../src/server/auth/invites");
  const { getOwnedModel, getOwnedInference } = await import("../src/server/lora/store");
  const { signedLoraFileUrl, verifyLoraFileUrl, loraStorageKey,
    validateDatasetZip, validateSafetensors } = await import("../src/server/lora/private-files");
  const { mediaPath, savePrivateFile } = await import("../src/server/storage/private-files");
  const { runLoraWorkerCycle, TRAINER_MODEL, INFERENCE_MODEL } = await import("../src/server/lora/worker");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const datasetRoute = await import("../src/app/api/lora/datasets/route");
  const modelRoute = await import("../src/app/api/lora/models/route");
  const imageRoute = await import("../src/app/api/lora/inferences/route");
  const fileRoute = await import("../src/app/api/lora/files/[kind]/[id]/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const signup = async (email: string) => {
      const invitation = createInvite({ email });
      const response = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "LoRA Tester", email, password: "LoRA-test-password-123!",
          inviteToken: invitation.token })
      }));
      assert.equal(response.status, 200);
      return { cookie: response.headers.get("set-cookie")!.split(";")[0],
        id: (await response.json()).user.id as string };
    };
    const owner = await signup("lora-owner@example.test");
    const other = await signup("lora-other@example.test");
    const zip = datasetZip();
    const upload = (cookie: string, origin = "http://localhost:3000") => datasetRoute.POST(
      new Request("http://localhost:3000/api/lora/datasets", { method: "POST",
        headers: { cookie, origin, "content-type": "application/zip" }, body: new Uint8Array(zip) }));
    assert.equal((await datasetRoute.GET(new Request("http://localhost:3000/api/lora/datasets"))).status, 401);
    assert.equal((await upload(owner.cookie, "https://evil.example.test")).status, 403);
    const uploaded = await upload(owner.cookie);
    assert.equal(uploaded.status, 201, JSON.stringify(await uploaded.clone().json()));
    const datasetId = (await uploaded.json()).dataset.id as string;
    assert.equal(await validateDatasetZip(mediaPath(loraStorageKey("dataset", datasetId))), 4);
    assert.equal((await datasetRoute.GET(new Request("http://localhost:3000/api/lora/datasets",
      { headers: { cookie: other.cookie } }))).status, 200);
    const guestFile = new Request(`http://localhost:3000/api/lora/files/dataset/${datasetId}`);
    const context = { params: Promise.resolve({ kind: "dataset", id: datasetId }) };
    assert.equal((await fileRoute.GET(guestFile, context)).status, 404);
    assert.equal((await fileRoute.GET(new Request(guestFile.url, { headers: { cookie: other.cookie } }), context)).status, 404);
    const signed = signedLoraFileUrl("dataset", datasetId);
    const signedUrl = new URL(signed);
    assert.equal(verifyLoraFileUrl("dataset", datasetId, signedUrl.searchParams.get("expires"),
      signedUrl.searchParams.get("token")), true);
    assert.equal((await fileRoute.GET(new Request(signed), context)).status, 200);
    signedUrl.searchParams.set("token", "x".repeat(43));
    assert.equal((await fileRoute.GET(new Request(signedUrl), context)).status, 404);

    const trainId = randomUUID();
    const trainBody = { requestId: trainId, datasetId, name: "Test LoRA", triggerWord: "loomstyle", steps: 500, rank: 16 };
    const training = (cookie: string, body = trainBody) => modelRoute.POST(new Request("http://localhost:3000/api/lora/models", {
      method: "POST", headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify(body)
    }));
    assert.equal((await training(other.cookie)).status, 404);
    assert.equal((await training(owner.cookie)).status, 202);
    assert.equal((await training(owner.cookie)).status, 200);
    assert.equal((await training(owner.cookie, { ...trainBody, name: "Different name" })).status, 409);
    let trainingPosts = 0, inferencePosts = 0;
    const submit = async ({ model, input }: { model: string; input: Record<string, unknown> }) => {
      if (model === TRAINER_MODEL) {
        trainingPosts++;
        assert.equal((input.data as string).startsWith(`https://ailoom.example.test/api/lora/files/dataset/${datasetId}?`), true);
        return providerTask("trainedPrediction1", TRAINER_MODEL, "queued");
      }
      inferencePosts++;
      assert.equal(model, INFERENCE_MODEL);
      assert.equal((input.loras as Array<{ path: string }>)[0].path.startsWith(
        `https://ailoom.example.test/api/lora/files/weights/${trainId}?`), true);
      assert.match(input.prompt as string, /loomstyle/);
      return providerTask("imagePrediction1", INFERENCE_MODEL, "queued");
    };
    const get = async ({ predictionId }: { predictionId: string }) =>
      providerTask(predictionId, predictionId === "trainedPrediction1" ? TRAINER_MODEL : INFERENCE_MODEL,
        "completed", predictionId === "trainedPrediction1"
          ? "https://cdn.wavespeed.ai/test.safetensors" : "https://cdn.wavespeed.ai/test.png");
    const importWeights = async (_url: string, id: string) => {
      const storageKey = loraStorageKey("weights", id);
      const file = mediaPath(storageKey);
      mkdirSync(join(file, ".."), { recursive: true });
      const bytes = tinySafetensors();
      writeFileSync(file, bytes);
      await validateSafetensors(file);
      return { storageKey, sizeBytes: bytes.length };
    };
    await runLoraWorkerCycle({ submit, get, importWeights,
      importImage: async () => savePrivateFile(PNG, "image/png") });
    assert.equal(trainingPosts, 1);
    await runLoraWorkerCycle({ submit, get, importWeights,
      importImage: async () => savePrivateFile(PNG, "image/png") });
    assert.equal(getOwnedModel(owner.id, trainId)?.state, "ready");
    assert.equal(trainingPosts, 1);
    const weightContext = { params: Promise.resolve({ kind: "weights", id: trainId }) };
    assert.equal((await fileRoute.GET(new Request(`http://localhost:3000/api/lora/files/weights/${trainId}`),
      weightContext)).status, 404);
    assert.equal((await fileRoute.GET(new Request(`http://localhost:3000/api/lora/files/weights/${trainId}`,
      { headers: { cookie: owner.cookie } }), weightContext)).status, 200);
    assert.equal((await fileRoute.GET(new Request(signedLoraFileUrl("weights", trainId)), weightContext)).status, 200);
    const imageId = randomUUID();
    const imageBody = { requestId: imageId, modelId: trainId, prompt: "A portrait", scale: 1, size: "512*512" };
    const generate = (cookie: string, body = imageBody) => imageRoute.POST(new Request("http://localhost:3000/api/lora/inferences", {
      method: "POST", headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify(body)
    }));
    assert.equal((await generate(other.cookie)).status, 404);
    assert.equal((await generate(owner.cookie)).status, 202);
    assert.equal((await generate(owner.cookie)).status, 200);
    await runLoraWorkerCycle({ submit, get, importImage: async () => savePrivateFile(PNG, "image/png") });
    await runLoraWorkerCycle({ submit, get, importImage: async () => savePrivateFile(PNG, "image/png") });
    assert.equal(inferencePosts, 1);
    assert.equal(getOwnedInference(owner.id, imageId)?.state, "ready");
    assert.equal(getOwnedInference(other.id, imageId), null);
    const unknownId = randomUUID();
    assert.equal((await training(owner.cookie, { ...trainBody, requestId: unknownId, name: "Maybe charged" })).status, 202);
    let unknownPosts = 0;
    const uncertainSubmit: typeof submit = async () => {
      unknownPosts++;
      throw new WaveSpeedError(0, "uncertain_submission");
    };
    await runLoraWorkerCycle({ submit: uncertainSubmit });
    await runLoraWorkerCycle({ submit: uncertainSubmit });
    assert.equal(unknownPosts, 1);
    assert.equal(getOwnedModel(owner.id, unknownId)?.state, "uncertain");

    const lostTrainingId = randomUUID();
    assert.equal((await training(owner.cookie, { ...trainBody, requestId: lostTrainingId,
      name: "Training lease race" })).status, 202);
    await runLoraWorkerCycle({ submit: async ({ model }) =>
      providerTask("lostTrainingPrediction", model, "queued") });
    let abandonedWeights = "";
    await runLoraWorkerCycle({
      get: async () => providerTask("lostTrainingPrediction", TRAINER_MODEL, "completed",
        "https://cdn.wavespeed.ai/lost.safetensors"),
      importWeights: async (_url, id) => {
        abandonedWeights = `lora/weights/${id}-${randomUUID()}.safetensors`;
        const file = mediaPath(abandonedWeights);
        mkdirSync(join(file, ".."), { recursive: true });
        const bytes = tinySafetensors();
        writeFileSync(file, bytes);
        getSqlite().prepare("UPDATE lora_model SET lease_owner = ? WHERE id = ?")
          .run("another-worker", lostTrainingId);
        return { storageKey: abandonedWeights, sizeBytes: bytes.length };
      }
    });
    assert.equal(getOwnedModel(owner.id, lostTrainingId)?.weightStorageKey, null);
    assert.equal(existsSync(mediaPath(abandonedWeights)), false);

    const lostLeaseId = randomUUID();
    assert.equal((await generate(owner.cookie, { ...imageBody, requestId: lostLeaseId,
      prompt: "Lease race portrait" })).status, 202);
    const lostSubmit = async ({ model }: { model: string }) =>
      providerTask("lostLeasePrediction", model, "queued");
    const lostGet = async () => providerTask("lostLeasePrediction", INFERENCE_MODEL, "completed",
      "https://cdn.wavespeed.ai/lost.png");
    await runLoraWorkerCycle({ submit: lostSubmit });
    const beforeAssets = (getSqlite().prepare('SELECT COUNT(*) AS count FROM asset WHERE "ownerId" = ?')
      .get(owner.id) as { count: number }).count;
    let importedKey = "";
    await runLoraWorkerCycle({ get: lostGet, importImage: async () => {
      const stored = await savePrivateFile(PNG, "image/png");
      importedKey = stored.storageKey;
      getSqlite().prepare("UPDATE lora_inference SET lease_owner = ? WHERE id = ?")
        .run("another-worker", lostLeaseId);
      return stored;
    } });
    assert.equal(getOwnedInference(owner.id, lostLeaseId)?.outputAssetId, null);
    assert.equal((getSqlite().prepare('SELECT COUNT(*) AS count FROM asset WHERE "ownerId" = ?')
      .get(owner.id) as { count: number }).count, beforeAssets);
    assert.equal(existsSync(mediaPath(importedKey)), false);
  } finally {
    getSqlite().close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
