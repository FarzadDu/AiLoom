import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" })
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const invite = sqliteTable("invite", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  tokenHash: text("tokenHash").notNull(),
  createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  redeemedAt: integer("redeemedAt", { mode: "timestamp" }),
  redeemedByUserId: text("redeemedByUserId").references(() => user.id, { onDelete: "set null" }),
  revokedAt: integer("revokedAt", { mode: "timestamp" })
}, (table) => [uniqueIndex("invite_token_hash_idx").on(table.tokenHash), index("invite_email_idx").on(table.email)]);

// Product data lives beside auth data so a single local SQLite database can
// back the web process and the generation worker.
export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  ownerId: text("ownerId").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
}, (table) => [index("project_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

export const conversation = sqliteTable("conversation", {
  id: text("id").primaryKey(),
  ownerId: text("ownerId").notNull().references(() => user.id, { onDelete: "cascade" }),
  projectId: text("projectId").references(() => project.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  modelId: text("modelId"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  archivedAt: integer("archivedAt", { mode: "timestamp" })
}, (table) => [
  index("conversation_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id),
  index("conversation_project_idx").on(table.projectId)
]);

export const message = sqliteTable("message", {
  id: text("id").primaryKey(),
  conversationId: text("conversationId").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
  modelId: text("modelId"),
  blocksJson: text("blocksJson").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull()
}, (table) => [
  index("message_conversation_created_idx").on(table.conversationId, table.createdAt, table.id),
  uniqueIndex("message_conversation_position_idx").on(table.conversationId, table.position)
]);

export const userPreference = sqliteTable("user_preference", {
  userId: text("userId").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  savedModelId: text("savedModelId"),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
});

export const asset = sqliteTable("asset", {
  id: text("id").primaryKey(),
  ownerId: text("ownerId").notNull().references(() => user.id, { onDelete: "cascade" }),
  projectId: text("projectId").references(() => project.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["image", "video", "audio", "file"] }).notNull(),
  source: text("source", { enum: ["upload", "generation"] }).notNull(),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  internal: integer("internal", { mode: "boolean" }).notNull().default(false),
  mimeType: text("mimeType").notNull(),
  originalName: text("originalName"),
  sizeBytes: integer("sizeBytes").notNull(),
  storageKey: text("storageKey").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
}, (table) => [
  index("asset_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  index("asset_project_idx").on(table.projectId),
  index("asset_visibility_idx").on(table.visibility),
  uniqueIndex("asset_storage_key_idx").on(table.storageKey)
]);

export const generationJob = sqliteTable("generation_job", {
  id: text("id").primaryKey(),
  ownerId: text("ownerId").notNull().references(() => user.id, { onDelete: "cascade" }),
  projectId: text("projectId").references(() => project.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["image", "video", "audio", "edit", "upscale", "transcription"] }).notNull(),
  provider: text("provider").notNull(),
  providerModel: text("providerModel").notNull(),
  externalId: text("externalId"),
  state: text("state", { enum: ["queued", "submitting", "running", "succeeded", "failed", "cancelled"] }).notNull().default("queued"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
  inputJson: text("inputJson").notNull(),
  outputJson: text("outputJson"),
  costEstimateMicrosUsd: integer("costEstimateMicrosUsd"),
  errorCode: text("errorCode"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  completedAt: integer("completedAt", { mode: "timestamp" })
}, (table) => [
  index("generation_job_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  index("generation_job_state_created_idx").on(table.state, table.createdAt),
  index("generation_job_provider_external_idx").on(table.provider, table.externalId)
]);

// Direct ElevenLabs voice tools are owner scoped. A request UUID is also the
// local idempotency key; uncertain provider outcomes are never retried blindly.
export const voiceClone = sqliteTable("voice_clone", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  providerName: text("provider_name").notNull(),
  sampleHash: text("sample_hash").notNull(),
  sampleMimeType: text("sample_mime_type").notNull(),
  sampleSizeBytes: integer("sample_size_bytes").notNull(),
  consentAt: integer("consent_at", { mode: "timestamp" }).notNull(),
  state: text("state", { enum: ["submitting", "ready", "verification_required", "failed", "uncertain"] }).notNull(),
  providerVoiceId: text("provider_voice_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("voice_clone_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  uniqueIndex("voice_clone_provider_voice_idx").on(table.providerVoiceId)
]);

export const voiceSpeech = sqliteTable("voice_speech", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  cloneId: text("clone_id").notNull().references(() => voiceClone.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  state: text("state", { enum: ["submitting", "ready", "failed", "uncertain"] }).notNull(),
  outputAssetId: text("output_asset_id").references(() => asset.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("voice_speech_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  index("voice_speech_clone_idx").on(table.cloneId, table.createdAt)
]);

// A chat image request is reserved before its paid OpenRouter POST. Once a
// request leaves the server, an unknown provider outcome must not be retried.
export const chatImageRequest = sqliteTable("chat_image_request", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  state: text("state", { enum: ["submitting", "succeeded", "failed", "uncertain"] }).notNull(),
  responseJson: text("response_json"),
  errorCode: text("error_code"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [index("chat_image_request_owner_created_idx").on(table.ownerId, table.createdAt, table.id)]);

// One durable request ID per text turn. A crash or interrupted stream cannot
// silently submit a second billable chat completion for the same input.
export const chatTextRequest = sqliteTable("chat_text_request", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  state: text("state", { enum: ["submitting", "completed", "failed", "uncertain"] }).notNull(),
  conversationId: text("conversation_id").references(() => conversation.id, { onDelete: "set null" }),
  userMessageId: text("user_message_id").references(() => message.id, { onDelete: "set null" }),
  assistantMessageId: text("assistant_message_id").references(() => message.id, { onDelete: "set null" }),
  errorCode: text("error_code"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [index("chat_text_request_owner_created_idx").on(table.ownerId, table.createdAt, table.id)]);

// A storyboard is private to its owner. Shots also carry ownerId so the
// composite foreign key prevents attaching a shot to another owner's board.
export const storyboard = sqliteTable("storyboard", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [
  uniqueIndex("storyboard_id_owner_idx").on(table.id, table.ownerId),
  index("storyboard_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id),
  index("storyboard_project_idx").on(table.projectId)
]);

export const storyboardShot = sqliteTable("storyboard_shot", {
  id: text("id").primaryKey(),
  storyboardId: text("storyboard_id").notNull(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  modelId: text("model_id").notNull(),
  durationSec: integer("duration_sec").notNull(),
  aspectRatio: text("aspect_ratio", { enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] }).notNull(),
  firstFrameAssetId: text("first_frame_asset_id").references(() => asset.id, { onDelete: "set null" }),
  lastFrameAssetId: text("last_frame_asset_id").references(() => asset.id, { onDelete: "set null" }),
  referenceAssetIdsJson: text("reference_asset_ids_json").notNull().default("[]"),
  outputAssetId: text("output_asset_id").references(() => asset.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [
  foreignKey({ name: "storyboard_shot_board_owner_fk",
    columns: [table.storyboardId, table.ownerId],
    foreignColumns: [storyboard.id, storyboard.ownerId] }).onDelete("cascade"),
  uniqueIndex("storyboard_shot_position_idx").on(table.storyboardId, table.position),
  index("storyboard_shot_owner_board_idx").on(table.ownerId, table.storyboardId)
]);

export const exploreTemplate = sqliteTable("explore_template", {
  id: text("id").primaryKey(),
  ownerId: text("ownerId").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  definitionJson: text("definitionJson").notNull(),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
}, (table) => [
  index("explore_template_owner_updated_idx").on(table.ownerId, table.updatedAt),
  index("explore_template_visibility_category_idx").on(table.visibility, table.category)
]);

export const exploreStarterSeed = sqliteTable("explore_starter_seed", {
  ownerId: text("ownerId").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  seededAt: integer("seededAt", { mode: "timestamp" }).notNull()
});
export const specialistProfile = sqliteTable("specialist_profile", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  description: text("description").notNull(),
  systemPrompt: text("systemPrompt").notNull(),
  sourceLinksJson: text("sourceLinksJson").notNull().default("[]"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdByUserId: text("createdByUserId").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
}, (table) => [index("specialist_profile_enabled_domain_idx").on(table.enabled, table.domain)]);

// ZIP datasets and LoRA weights are stored as private files. Provider access
// uses short-lived signed URLs, never a public asset visibility switch.
export const loraDataset = sqliteTable("lora_dataset", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  imageCount: integer("image_count").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("lora_dataset_owner_created_idx").on(table.ownerId, table.createdAt),
  uniqueIndex("lora_dataset_storage_idx").on(table.storageKey)
]);

export const loraModel = sqliteTable("lora_model", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  datasetId: text("dataset_id").notNull().references(() => loraDataset.id),
  name: text("name").notNull(),
  triggerWord: text("trigger_word"),
  steps: integer("steps").notNull(),
  rank: integer("rank").notNull(),
  inputHash: text("input_hash").notNull(),
  state: text("state", { enum: ["queued", "submitting", "running", "importing", "ready", "failed", "uncertain"] }).notNull(),
  providerTaskId: text("provider_task_id"),
  weightStorageKey: text("weight_storage_key"),
  weightSizeBytes: integer("weight_size_bytes"),
  errorCode: text("error_code"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("lora_model_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  index("lora_model_state_created_idx").on(table.state, table.createdAt),
  uniqueIndex("lora_model_provider_task_idx").on(table.providerTaskId)
]);

export const loraInference = sqliteTable("lora_inference", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull().references(() => loraModel.id),
  prompt: text("prompt").notNull(),
  scale: integer("scale_milli").notNull(),
  size: text("size").notNull(),
  inputHash: text("input_hash").notNull(),
  state: text("state", { enum: ["queued", "submitting", "running", "importing", "ready", "failed", "uncertain"] }).notNull(),
  providerTaskId: text("provider_task_id"),
  outputAssetId: text("output_asset_id").references(() => asset.id, { onDelete: "set null" }),
  errorCode: text("error_code"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("lora_inference_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  index("lora_inference_state_created_idx").on(table.state, table.createdAt),
  uniqueIndex("lora_inference_provider_task_idx").on(table.providerTaskId)
]);

// Dubbing v2 charges when a project is created. A queued request is claimed
// once before that POST; an uncertain submission is never automatically sent
// again. Polling/importing happens on a separate, read-only provider path.
export const dubbingJob = sqliteTable("dubbing_job", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sourceAssetId: text("source_asset_id").notNull(),
  sourceKind: text("source_kind", { enum: ["audio", "video"] }).notNull(),
  sourceLanguage: text("source_language"),
  targetLanguage: text("target_language").notNull(),
  inputHash: text("input_hash").notNull(),
  state: text("state", { enum: ["queued", "submitting", "running", "importing", "ready", "failed", "uncertain"] }).notNull(),
  providerProjectId: text("provider_project_id"),
  providerLanguageId: text("provider_language_id"),
  outputAssetId: text("output_asset_id").references(() => asset.id, { onDelete: "set null" }),
  errorCode: text("error_code"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
  nextPollAt: integer("next_poll_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("dubbing_job_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  index("dubbing_job_state_poll_idx").on(table.state, table.nextPollAt, table.createdAt),
  uniqueIndex("dubbing_job_provider_project_idx").on(table.providerProjectId)
]);

