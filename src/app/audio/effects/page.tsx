import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/access";
import EffectsStudio from "./effects-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EffectsPage() {
  const user = await getCurrentUser(await headers());
  return <EffectsStudio signedIn={Boolean(user)} name={user?.name ?? ""} userId={user?.id ?? null} />;
}
