import { getAuth } from "@/server/auth";
import { redeemInvite } from "@/server/auth/invites";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  const isSignUp = new URL(request.url).pathname.endsWith("/sign-up/email");
  if (isSignUp && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "JSON content type required" }, { status: 415 });
  }
  const signUpBody = isSignUp ? await request.clone().json().catch(() => null) : null;
  const response = await getAuth().handler(request);

  if (isSignUp && response.ok && signUpBody && typeof signUpBody === "object") {
    const result = await response.clone().json().catch(() => null);
    const user = result?.user;
    if (typeof user?.id === "string" && typeof user.email === "string") {
      const redeemed = redeemInvite(signUpBody.inviteToken, user.email, user.id);
      if (!redeemed) console.error("Ailoom sign-up succeeded but its invite was not redeemed");
    }
  }

  return response;
}
