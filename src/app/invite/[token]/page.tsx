import { redirect } from "next/navigation";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/?invite=${encodeURIComponent(token)}`);
}
