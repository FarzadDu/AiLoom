import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createExploreTemplate, ensureStarterTemplates, listExploreTemplates, templateDefinitionSchema } from "@/server/content/templates";

export const runtime = "nodejs";

const createInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  category: z.string().trim().min(1).max(80),
  definition: templateDefinitionSchema
}).strict();

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  const url = new URL(request.url);
  const query = z.object({
    category: z.string().trim().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100)
  }).safeParse({
    category: url.searchParams.get("category") || undefined,
    limit: url.searchParams.get("limit") || undefined
  });
  if (!query.success) return Response.json({ error: "Invalid filters." }, { status: 400 });
  if (current) ensureStarterTemplates(current.id);
  return Response.json({ templates: listExploreTemplates(current?.id ?? null, query.data) },
    { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = createInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid template." }, { status: 400 });
  return Response.json({ template: createExploreTemplate(current.id, input.data) }, { status: 201 });
}

