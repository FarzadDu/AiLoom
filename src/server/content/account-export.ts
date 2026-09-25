import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  asset, conversation, exploreTemplate, generationJob, message, project, user, userPreference
} from "../db/schema";

function jobSummary(inputJson: string, outputJson: string | null) {
  let prompt: string | null = null;
  let outputAssetIds: string[] = [];
  try {
    const input = JSON.parse(inputJson) as Record<string, unknown>;
    const request = input.request && typeof input.request === "object"
      ? input.request as Record<string, unknown> : input;
    const text = request.prompt ?? request.text;
    if (typeof text === "string") prompt = text;
  } catch { /* Historical data may predate current request schemas. */ }
  try {
    const output = outputJson ? JSON.parse(outputJson) as Record<string, unknown> : null;
    if (Array.isArray(output?.assets)) outputAssetIds = output.assets.flatMap(item => {
      const id = item && typeof item === "object" ? (item as Record<string, unknown>).id : null;
      return typeof id === "string" ? [id] : [];
    });
  } catch { /* Keep the export usable if one old job has malformed output. */ }
  return { prompt, outputAssetIds };
}

// Keep this export limited to records owned by the signed-in account. Passwords,
// sessions, invitation tokens, provider job IDs and private storage paths are
// deliberately outside the portable data format.
export function accountExport(userId: string) {
  const db = getDb();
  const owner = db.select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
    .from(user).where(eq(user.id, userId)).get();
  if (!owner) return null;

  const conversations = db.select().from(conversation)
    .where(eq(conversation.ownerId, userId)).orderBy(asc(conversation.createdAt)).all();
  const messages = db.select({
    id: message.id, conversationId: message.conversationId, position: message.position,
    role: message.role, modelId: message.modelId, blocksJson: message.blocksJson,
    createdAt: message.createdAt
  }).from(message).innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(eq(conversation.ownerId, userId)).orderBy(asc(message.createdAt), asc(message.id)).all()
    .map(({ blocksJson, ...row }) => ({ ...row, blocks: JSON.parse(blocksJson) as unknown }));
  const assets = db.select({
    id: asset.id, projectId: asset.projectId, kind: asset.kind, source: asset.source,
    visibility: asset.visibility, mimeType: asset.mimeType, originalName: asset.originalName,
    sizeBytes: asset.sizeBytes, createdAt: asset.createdAt, updatedAt: asset.updatedAt
  }).from(asset).where(and(eq(asset.ownerId, userId), eq(asset.internal, false)))
    .orderBy(asc(asset.createdAt)).all()
    .map(row => ({ ...row, downloadPath: `/api/assets/${row.id}` }));
  const jobs = db.select({
    id: generationJob.id, projectId: generationJob.projectId, kind: generationJob.kind,
    provider: generationJob.provider, providerModel: generationJob.providerModel,
    state: generationJob.state, inputJson: generationJob.inputJson, outputJson: generationJob.outputJson,
    costEstimateMicrosUsd: generationJob.costEstimateMicrosUsd,
    errorCode: generationJob.errorCode, createdAt: generationJob.createdAt,
    updatedAt: generationJob.updatedAt, completedAt: generationJob.completedAt
  }).from(generationJob).where(eq(generationJob.ownerId, userId))
    .orderBy(asc(generationJob.createdAt)).all()
    .map(({ inputJson, outputJson, ...row }) => ({ ...row, ...jobSummary(inputJson, outputJson) }));
  const templates = db.select({
    id: exploreTemplate.id, title: exploreTemplate.title, description: exploreTemplate.description,
    category: exploreTemplate.category, definitionJson: exploreTemplate.definitionJson,
    visibility: exploreTemplate.visibility, createdAt: exploreTemplate.createdAt,
    updatedAt: exploreTemplate.updatedAt
  }).from(exploreTemplate).where(eq(exploreTemplate.ownerId, userId))
    .orderBy(asc(exploreTemplate.createdAt)).all()
    .map(({ definitionJson, ...row }) => ({ ...row, definition: JSON.parse(definitionJson) as unknown }));
  const preference = db.select({ savedModelId: userPreference.savedModelId })
    .from(userPreference).where(eq(userPreference.userId, userId)).get() ?? null;

  return {
    format: "ailoom-account-v1", exportedAt: new Date().toISOString(), owner,
    projects: db.select().from(project).where(eq(project.ownerId, userId))
      .orderBy(asc(project.createdAt)).all(),
    conversations, messages, assets, jobs, templates, preference
  };
}
