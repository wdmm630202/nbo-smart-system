import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const title = "NBO南铂智能系统";
  const description = "南铂摄影的 App、网页、自动化工作流与 AI 智能体统一入口。";

  return {
    metadataBase,
    title,
    description,
    icons: { icon: "/icon.png", shortcut: "/icon.png" },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "zh_CN",
      images: [{ url: "/og.png", width: 1730, height: 909, alt: "NBO南铂智能系统" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
