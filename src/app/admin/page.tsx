import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentAdmin } from "@/server/auth/access";
import { listInvites } from "@/server/auth/invites";
import AdminInvites from "./admin-invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getCurrentAdmin(await headers());
  if (!admin) notFound();

  const invites = listInvites().map(row => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null
  }));

  return <AdminInvites initialInvites={invites} adminEmail={admin.email} />;
}
