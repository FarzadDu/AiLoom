import { z } from "zod";
import { getDb } from "../src/server/db";
import { user } from "../src/server/db/schema";
import { createInvite, inviteUrl } from "../src/server/auth/invites";

const email = process.env.ADMIN_EMAIL?.trim();
if (!email || !z.email().safeParse(email).success) {
  throw new Error("Set ADMIN_EMAIL to a valid email address before bootstrapping");
}

if (getDb().select({ id: user.id }).from(user).limit(1).get()) {
  throw new Error("Bootstrap is only available before the first account exists");
}

const created = createInvite({ email, role: "admin", expiresInDays: 7 });
console.log(`Admin invite for ${created.invite.email} (expires ${created.invite.expiresAt.toISOString()}):`);
console.log(inviteUrl(created.token));
