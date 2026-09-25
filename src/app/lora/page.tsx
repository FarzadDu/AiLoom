import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/access";
import LoraStudio from "./studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoraPage() {
  const user = await getCurrentUser(await headers());
  return <LoraStudio signedIn={Boolean(user)} isAdmin={user?.role === "admin"} />;
}
