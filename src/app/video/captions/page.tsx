import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/access";
import CaptionStudio from "./caption-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function VideoCaptionsPage() {
  const user = await getCurrentUser(await headers());
  return <CaptionStudio signedIn={Boolean(user)} />;
}
