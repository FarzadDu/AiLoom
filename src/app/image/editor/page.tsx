import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/access";
import ImageLayerEditor from "./image-layer-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ImageEditorPage() {
  const user = await getCurrentUser(await headers());
  return <ImageLayerEditor key={user?.id ?? "guest"} userId={user?.id ?? null} />;
}
