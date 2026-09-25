import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/access";
import StoryboardStudio from "./storyboard-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StoryboardsPage() {
  const user = await getCurrentUser(await headers());
  return <StoryboardStudio user={user ? { id: user.id, email: user.email, name: user.name } : null} />;
}
