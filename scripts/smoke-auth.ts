import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const directory = mkdtempSync(join(tmpdir(), "ailoom-auth-"));
process.env.DATABASE_PATH = join(directory, "smoke.sqlite");
process.env.BETTER_AUTH_SECRET = "smoke-test-only-secret-must-be-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.PUBLIC_BASE_URL = "http://localhost:3000";

async function main() {
  const { getDb, getSqlite } = await import("../src/server/db");
  const { user } = await import("../src/server/db/schema");
  const { createInvite, getValidInvite } = await import("../src/server/auth/invites");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const adminRoute = await import("../src/app/api/admin/invites/route");
  const { getCurrentAdmin } = await import("../src/server/auth/access");
  const { eq } = await import("drizzle-orm");

  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });

    const signUp = (email: string, inviteToken?: string) => authRoute.POST(new Request(
      "http://localhost:3000/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          name: "Ailoom Tester",
          email,
          password: "Ailoom-test-password-123!",
          inviteToken
        })
      }
    ));

    const denied = await signUp("admin@example.test");
    assert.equal(denied.status, 403, "public signup must be denied");

    const adminInvite = createInvite({ email: "admin@example.test", role: "admin" });
    const created = await signUp("admin@example.test", adminInvite.token);
    assert.equal(created.status, 200, "invited admin signup must succeed");
    assert.equal(getValidInvite(adminInvite.token), null, "invite must be one-time use");

    const adminUser = getDb().select().from(user).where(eq(user.email, "admin@example.test")).get();
    assert.equal(adminUser?.role, "admin", "admin bootstrap invite must assign admin role");

    const signIn = await authRoute.POST(new Request(
      "http://localhost:3000/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          email: "admin@example.test",
          password: "Ailoom-test-password-123!"
        })
      }
    ));
    assert.equal(signIn.status, 200, "invited account must be able to sign in later");

    const cookie = created.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "signup must set a session cookie");
    const adminHeaders = new Headers({ cookie });
    assert.equal((await getCurrentAdmin(adminHeaders))?.id, adminUser?.id);

    const adminCreateResponse = await adminRoute.POST(new Request(
      "http://localhost:3000/api/admin/invites",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie
        },
        body: JSON.stringify({ email: "member@example.test" })
      }
    ));
    assert.equal(adminCreateResponse.status, 201, "admin should be able to invite users");
    const memberInvite = await adminCreateResponse.json();
    assert.match(memberInvite.inviteUrl, /^http:\/\/localhost:3000\/invite\//);

    const memberToken = memberInvite.inviteUrl.split("/").at(-1);
    const memberSignup = await signUp("member@example.test", memberToken);
    assert.equal(memberSignup.status, 200);
    const memberCookie = memberSignup.headers.get("set-cookie")?.split(";")[0];
    assert.ok(memberCookie);
    assert.equal(await getCurrentAdmin(new Headers({ cookie: memberCookie })), null);

    const blockedMemberInvite = await adminRoute.POST(new Request(
      "http://localhost:3000/api/admin/invites",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: memberCookie
        },
        body: JSON.stringify({ email: "other@example.test" })
      }
    ));
    assert.equal(blockedMemberInvite.status, 403, "non-admin must not create invites");

    console.log("Auth smoke test passed: invite gate, signup, one-time token, roles, admin API.");
  } finally {
    getSqlite().close();
  }
}

try {
  await main();
} finally {
  const tempRoot = resolve(tmpdir());
  const candidate = resolve(directory);
  const withinTemp = relative(tempRoot, candidate);
  if (!withinTemp.startsWith("..") && withinTemp !== "" && !withinTemp.includes(":")) {
    rmSync(candidate, { recursive: true, force: true });
  }
}
