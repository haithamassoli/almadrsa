import Link from "next/link";
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  KeyRound,
  MessagesSquare,
  Users,
} from "lucide-react";
import { LogoMark } from "@/components/app-shell/logo-mark";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { LiveIndicator } from "@/components/live-indicator";
import { t } from "@/lib/i18n";

const features = [
  { icon: ClipboardCheck, title: t("home.fAttendance"), body: t("home.fAttendanceBody") },
  { icon: BookOpenCheck, title: t("home.fHomework"), body: t("home.fHomeworkBody") },
  { icon: GraduationCap, title: t("home.fExams"), body: t("home.fExamsBody") },
  { icon: CalendarDays, title: t("home.fCalendar"), body: t("home.fCalendarBody") },
  { icon: MessagesSquare, title: t("home.fMessages"), body: t("home.fMessagesBody") },
  { icon: FileText, title: t("home.fReports"), body: t("home.fReportsBody") },
] as const;

// The khatam eight-point star from the logo (two overlapping squares), reused
// as the brand's structural glyph — gold, marks eyebrows.
function KhatamGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <g fill="#dba341">
        <rect x="6" y="6" width="12" height="12" />
        <rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" />
      </g>
    </svg>
  );
}

// Ambient zellij: the same star tessellated into a framed lattice, drawn in
// teal at low opacity and faded toward the content. Pure SVG — no client JS.
function GirihField() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full text-primary opacity-[0.06] [mask-image:radial-gradient(115%_95%_at_50%_0%,#000,transparent_72%)] dark:opacity-[0.09]"
    >
      <defs>
        <pattern id="zellij" width="112" height="112" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="112" height="112" fill="none" stroke="currentColor" strokeWidth="1" />
          <g fill="none" stroke="currentColor" strokeWidth="1.25">
            <rect x="34" y="34" width="44" height="44" />
            <rect x="34" y="34" width="44" height="44" transform="rotate(45 56 56)" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#zellij)" />
    </svg>
  );
}

export default function Home() {
  const appName = t("common.appName");
  return (
    <>
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link
          href="/"
          aria-label={appName}
          className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LogoMark className="size-9" />
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex-1">
        {/* Threshold: the school's name, then the door you belong to. */}
        <section className="relative isolate overflow-hidden px-5 pt-8 pb-16 sm:px-8 sm:pt-14">
          <GirihField />
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <KhatamGlyph className="size-3.5" />
              {t("common.tagline")}
            </p>
            <h1 className="mt-5 text-[clamp(3.75rem,15vw,8.5rem)] leading-[0.92] font-black">
              {appName}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground text-balance sm:text-xl">
              {t("home.heroSub")}
            </p>

            <div className="mt-10 grid w-full gap-3 text-start sm:grid-cols-2">
              {/* Primary door: most arrivals are parents & students. */}
              <Link
                href="/code"
                className="group relative flex flex-col gap-3 rounded-2xl bg-primary p-5 text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <KeyRound className="size-6" aria-hidden />
                <span className="text-lg font-bold">{t("auth.studentLogin")}</span>
                <span className="text-sm text-primary-foreground/80">
                  {t("home.studentDoorBody")}
                </span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                  {t("home.studentDoorCta")}
                  <ArrowLeft
                    className="size-4 transition-transform group-hover:-translate-x-1"
                    aria-hidden
                  />
                </span>
              </Link>

              {/* Secondary door: staff. Quiet on purpose. */}
              <Link
                href="/login"
                className="group flex flex-col gap-3 rounded-2xl border bg-card p-5 transition-colors hover:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <Users className="size-5" aria-hidden />
                </span>
                <span className="text-lg font-bold">{t("auth.staffLogin")}</span>
                <span className="text-sm text-muted-foreground">
                  {t("home.staffDoorBody")}
                </span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  {t("home.staffDoorCta")}
                  <ArrowLeft
                    className="size-4 transition-transform group-hover:-translate-x-1"
                    aria-hidden
                  />
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* What lives inside — a ledger grid, like the school's own timetable. */}
        <section className="border-t bg-card/40 px-5 py-16 sm:px-8">
          <div className="mx-auto max-w-5xl">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <KhatamGlyph className="size-3.5" />
              {t("home.insideEyebrow")}
            </p>
            <h2 className="heading-rule mt-3 text-2xl font-black sm:text-3xl">
              {t("home.insideTitle")}
            </h2>
            <p className="mt-2 max-w-xl text-muted-foreground">{t("home.insideBody")}</p>

            <ul className="mt-9 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <li key={feature.title} className="flex flex-col gap-3 bg-card p-6">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <feature.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="font-bold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="flex flex-col items-center gap-3 px-5 py-8 text-center">
        <p className="text-xs text-muted-foreground">{t("home.offlineNote")}</p>
        <LiveIndicator />
      </footer>
    </>
  );
}
