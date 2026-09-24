import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

