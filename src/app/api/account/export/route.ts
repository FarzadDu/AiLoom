import { getCurrentUser } from "@/server/auth/access";
import { accountExport } from "@/server/content/account-export";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401,
    headers: { "Cache-Control": "private, no-store" } });
  const data = accountExport(current.id);
  if (!data) return Response.json({ error: "Account not found." }, { status: 404,
    headers: { "Cache-Control": "private, no-store" } });
  return new Response(JSON.stringify(data), { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="ailoom-export-${new Date().toISOString().slice(0, 10)}.json"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"
  } });
}
