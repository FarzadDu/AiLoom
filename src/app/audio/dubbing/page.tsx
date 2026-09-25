import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/access";
import DubbingStudio from "./dubbing-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DubbingPage() {
  const user = await getCurrentUser(await headers());
  return <DubbingStudio signedIn={Boolean(user)} name={user?.name ?? ""} />;
}
