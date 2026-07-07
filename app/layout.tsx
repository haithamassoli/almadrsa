import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { thmanyahSans } from "@/fonts";
import { Providers } from "@/components/providers";
import { getToken } from "@/lib/auth-server";
import { t } from "@/lib/i18n";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${t("common.appName")} — ${t("common.tagline")}`,
    template: `%s · ${t("common.appName")}`,
  },
  description: t("common.tagline"),
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
        {/* Follow system dark mode; runs before paint to avoid a flash.
            A stored override ("theme" in localStorage) wins if set. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("theme");var d=s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})()`,
          }}
        />
        <Providers initialToken={initialToken}>{children}</Providers>
      </body>
    </html>
  );
}
