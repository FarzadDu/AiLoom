import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createAsset, deleteAsset, getOwnedAsset } from "@/server/content/assets";
import { createGenerationJob } from "@/server/content/jobs";
import { publicJob } from "@/server/content/public-job";
import type { JsonValue } from "@/server/content/types";
import { videoToolPaths } from "@/server/media/binaries";
import { prepareMediaRequest } from "@/server/media/service";
import { prepareTemporalRepair, TemporalRepairError } from "@/server/media/temporal-repair";
import { signedAssetUrl } from "@/server/storage/asset-access";
import { mediaPath, mediaRoot } from "@/server/storage/private-files";

export const runtime = "nodejs";

const requestSchema = z.object({
  sourceAssetId: z.string().uuid(),
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().positive(),
  prompt: z.string().trim().min(1).max(4000)
}).strict();

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
  let input: z.infer<typeof requestSchema>;
  try { input = requestSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid repair request." }, { status: 400 }); }
  if (input.endSec <= input.startSec) return Response.json({ error: "Choose a valid repair interval." }, { status: 400 });
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
      sizeBytes: (await stat(plan.contextVideoPath)).size, storageKey: contextKey
    });
    createdAssets.push({ id: context.id, storageKey: context.storageKey });
    const mask = createAsset(current.id, {
      kind: "video", source: "generation", mimeType: "video/mp4",
      sizeBytes: (await stat(plan.maskVideoPath)).size, storageKey: maskKey
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
      modelId: "fal-ai/ltx-2.3-quality/inpaint",
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
      payload: {
        request: providerRequest,
        repair: { plan, sourceAssetId: source.id, contextAssetIds: [context.id, mask.id] }
      } as JsonValue
    });
    queued = true;
    return Response.json({ job: publicJob(job), interval: {
      startSec: plan.targetStartSec, endSec: plan.targetEndSec,
      contextStartSec: plan.contextStartSec, contextEndSec: plan.contextEndSec
    } }, { status: 202 });
  } catch (error) {
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
