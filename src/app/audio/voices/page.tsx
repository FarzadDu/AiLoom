import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/access";
import VoiceStudio from "./voice-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function VoicesPage() {
  const user = await getCurrentUser(await headers());
  return <VoiceStudio signedIn={Boolean(user)} name={user?.name ?? ""} />;
}
