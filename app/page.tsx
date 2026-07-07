import Link from "next/link";
import { KeyRound, Users } from "lucide-react";
import { LogoMark } from "@/components/app-shell/logo-mark";
import { LiveIndicator } from "@/components/live-indicator";
import { t } from "@/lib/i18n";

const entries = [
  {
    href: "/code",
    icon: KeyRound,
    title: t("auth.studentLogin"),
    description: t("auth.accessCodeHelp"),
  },
  {
    href: "/login",
    icon: Users,
    title: t("auth.staffLogin"),
    description: t("auth.loginRequired"),
  },
] as const;

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <LogoMark className="size-14" />
        <h1 className="text-4xl font-black tracking-tight">
          {t("common.appName")}
        </h1>
        <p className="text-muted-foreground">{t("common.tagline")}</p>
      </header>

      <nav className="grid w-full max-w-md gap-3">
        {entries.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="group flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-ring"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <entry.icon className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col">
              <span className="font-bold">{entry.title}</span>
              <span className="text-sm text-muted-foreground">
                {entry.description}
              </span>
            </span>
          </Link>
        ))}
      </nav>

      <footer>
        <LiveIndicator />
      </footer>
    </main>
  );
}
