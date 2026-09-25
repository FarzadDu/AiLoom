import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createAsset, deleteAsset, getOwnedAsset } from "@/server/content/assets";
import { createGenerationJob, GenerationIdempotencyConflictError, getGenerationJob } from "@/server/content/jobs";
import { getProject } from "@/server/content/projects";
import { publicJob } from "@/server/content/public-job";
import { ContentAccessError } from "@/server/content/shared";
import type { JsonValue } from "@/server/content/types";
import { videoToolPaths } from "@/server/media/binaries";
import { prepareMediaRequest } from "@/server/media/service";
import { prepareTemporalRepair, TemporalRepairError } from "@/server/media/temporal-repair";
import { signedAssetUrl } from "@/server/storage/asset-access";
import { mediaPath, mediaRoot } from "@/server/storage/private-files";
import { parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

const requestSchema = z.object({
  sourceAssetId: z.string().uuid(),
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().positive(),
  prompt: z.string().trim().min(1).max(4000),
  projectId: z.uuid().nullable().optional()
}).strict();

type RepairInput = z.infer<typeof requestSchema>;
type RepairJob = NonNullable<ReturnType<typeof getGenerationJob>>;
type RepairInterval = { startSec: number; endSec: number; contextStartSec: number; contextEndSec: number };
const REPAIR_MODEL = "fal-ai/ltx-2.3-quality/inpaint";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Compare the original user request, not randomized FFmpeg paths or expiring URLs. */
export function matchingRepairInterval(job: RepairJob, input: RepairInput): RepairInterval | null {
  if (job.kind !== "edit" || job.provider !== "fal" || job.providerModel !== REPAIR_MODEL ||
    job.projectId !== (input.projectId ?? null)) return null;
  const repair = record(record(job.input)?.repair);
  if (!repair || repair.sourceAssetId !== input.sourceAssetId) return null;
  const original = requestSchema.safeParse(repair.originalRequest);
  if (!original.success) return null;
  const { projectId: originalProjectId, ...originalRequest } = original.data;
  const { projectId: requestedProjectId, ...requestedInput } = input;
  if ((originalProjectId ?? null) !== (requestedProjectId ?? null) ||
    !isDeepStrictEqual(originalRequest, requestedInput)) return null;
  const plan = record(repair.plan);
  if (!plan) return null;
  const { targetStartSec, targetEndSec, contextStartSec, contextEndSec } = plan;
  if (![targetStartSec, targetEndSec, contextStartSec, contextEndSec]
    .every(value => typeof value === "number" && Number.isFinite(value)) ||
    (targetEndSec as number) <= (targetStartSec as number) ||
    (contextEndSec as number) <= (contextStartSec as number)) return null;
  return { startSec: targetStartSec as number, endSec: targetEndSec as number,
    contextStartSec: contextStartSec as number, contextEndSec: contextEndSec as number };
}

function replayRepair(ownerId: string, key: string, input: RepairInput): Response | null {
  const existing = getGenerationJob(ownerId, key);
  if (!existing) return null;
  const interval = matchingRepairInterval(existing, input);
  if (!interval) return Response.json({ error: "This request key was already used for a different repair." }, { status: 409 });
  return Response.json({ job: publicJob(existing), interval }, { status: 202 });
}

async function probeSignedAsset(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { Range: "bytes=0-0" }, redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
    await response.body?.cancel();
    return response.status === 200 || response.status === 206;
  } catch { return false; }
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const rawKey = request.headers.get("Idempotency-Key");
  if (!rawKey || !z.uuid().safeParse(rawKey).success) {
    return Response.json({ error: "A UUID Idempotency-Key is required." }, { status: 400 });
  }
  const key = rawKey.toLowerCase();
  const parsed = await parseBoundedJson(request, requestSchema, 16_000, "Invalid repair request.");
  if (!parsed.success) return parsed.response;
  const input = parsed.data;
  if (input.endSec <= input.startSec) return Response.json({ error: "Choose a valid repair interval." }, { status: 400 });
  if (input.projectId && !getProject(current.id, input.projectId)) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }
  const replay = replayRepair(current.id, key, input);
  if (replay) return replay;
  const source = getOwnedAsset(current.id, input.sourceAssetId);
  if (!source || source.kind !== "video" || !["video/mp4", "video/webm"].includes(source.mimeType)) {
    return Response.json({ error: "Source video not found." }, { status: 404 });
  }
  try { signedAssetUrl(randomUUID()); }
  catch { return Response.json({ error: "A public HTTPS deployment is needed for video repair." }, { status: 409 }); }

  const root = mediaRoot();
  const workDir = resolve(root, "repairs", randomUUID());
  if (!workDir.startsWith(root + sep)) return Response.json({ error: "Invalid repair storage." }, { status: 500 });
  const createdAssets: Array<{ id: string; storageKey: string }> = [];
  let queued = false;
  try {
    const plan = await prepareTemporalRepair({
      sourcePath: mediaPath(source.storageKey), workDir,
      startSec: input.startSec, endSec: input.endSec, prompt: input.prompt
    }, videoToolPaths());
    const contextKey = relative(root, plan.contextVideoPath).split(sep).join("/");
    const maskKey = relative(root, plan.maskVideoPath).split(sep).join("/");
    const context = createAsset(current.id, {
      kind: "video", source: "generation", mimeType: "video/mp4",
      sizeBytes: (await stat(plan.contextVideoPath)).size, storageKey: contextKey,
      projectId: input.projectId
    });
    createdAssets.push({ id: context.id, storageKey: context.storageKey });
    const mask = createAsset(current.id, {
      kind: "video", source: "generation", mimeType: "video/mp4",
      sizeBytes: (await stat(plan.maskVideoPath)).size, storageKey: maskKey,
      projectId: input.projectId
    });
    createdAssets.push({ id: mask.id, storageKey: mask.storageKey });
    const contextAccess = signedAssetUrl(context.id);
    const maskAccess = signedAssetUrl(mask.id);
    const [contextAvailable, maskAvailable] = await Promise.all([
      probeSignedAsset(contextAccess.url), probeSignedAsset(maskAccess.url)
    ]);
    if (!contextAvailable || !maskAvailable) {
      return Response.json({ error: "The public site cannot serve the repair references yet." }, { status: 409 });
    }
    const providerRequest = {
      modelId: REPAIR_MODEL,
      operation: "temporal_inpaint",
      prompt: plan.prompt,
      videoUrl: contextAccess.url,
      maskVideoUrl: maskAccess.url,
      frameCount: plan.frameCount,
      fps: plan.fps
    };
    prepareMediaRequest(providerRequest);
    const job = createGenerationJob(current.id, {
      kind: "edit", provider: "fal", providerModel: providerRequest.modelId,
      projectId: input.projectId,
      idempotencyKey: key,
      payload: {
        request: providerRequest,
        repair: { originalRequest: input, plan, sourceAssetId: source.id,
          contextAssetIds: [context.id, mask.id] }
      } as JsonValue
    });
    queued = true;
    return Response.json({ job: publicJob(job), interval: {
      startSec: plan.targetStartSec, endSec: plan.targetEndSec,
      contextStartSec: plan.contextStartSec, contextEndSec: plan.contextEndSec
    } }, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationIdempotencyConflictError) {
      // Another request with this key may have finished preprocessing first.
      return replayRepair(current.id, key, input) ??
        Response.json({ error: "Could not resolve the request key." }, { status: 409 });
    }
    if (error instanceof ContentAccessError) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    if (error instanceof TemporalRepairError) {
      return Response.json({ error: error.message, code: error.code }, { status: 422 });
    }
    return Response.json({ error: "Could not prepare the repair." }, { status: 500 });
  } finally {
    if (!queued) {
      for (const item of createdAssets) deleteAsset(current.id, item.id);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
