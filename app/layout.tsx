import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { thmanyahSans } from "@/fonts";
import { Providers } from "@/components/providers";
import { RegisterSW } from "@/components/register-sw";
import { getToken } from "@/lib/auth-server";
import { t } from "@/lib/i18n";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const appName = t("common.appName");
const tagline = t("common.tagline");
const title = `${appName} — ${tagline}`;

export const metadata: Metadata = {
  // Absolute base for og:image / twitter:image and other resolved URLs.
  // SITE_URL is the production origin (see docs/deploy.md); the domain default
  // keeps social-card images absolute even if SITE_URL is unset.
  metadataBase: new URL(process.env.SITE_URL ?? "https://almdrasa.assoli.site"),
  title: {
    default: title,
    template: `%s · ${appName}`,
  },
  description: tagline,
  openGraph: {
    type: "website",
    siteName: appName,
    locale: "ar_SA",
    title,
    description: tagline,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: tagline,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#12181c" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialToken = await getToken();
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${thmanyahSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <RegisterSW />
        {/* Dark mode via next-themes (attribute="class"); it injects its own
            pre-paint no-flash script. */}
        <Providers initialToken={initialToken}>{children}</Providers>
      </body>
    </html>
  );
}
