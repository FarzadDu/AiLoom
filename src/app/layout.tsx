import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ailoom — One space for your ideas",
  description: "A private, bilingual workspace for conversations, images, video, audio and focused guidance."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" dir="ltr" suppressHydrationWarning><body>{children}</body></html>;
}
