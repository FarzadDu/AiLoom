import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { user } from "../db/schema";
import { getAuth } from ".";
import { getBaseUrl } from "./invites";

export async function getCurrentUser(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;

  return getDb().select({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  }).from(user).where(eq(user.id, session.user.id)).get() ?? null;
}

export async function getCurrentAdmin(headers: Headers) {
  const current = await getCurrentUser(headers);
  return current?.role === "admin" ? current : null;
}

export function mutationOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).origin === new URL(getBaseUrl()).origin;
  } catch {
    return false;
  }
}
