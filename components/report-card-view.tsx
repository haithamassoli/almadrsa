"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { LogoMark } from "@/components/app-shell/logo-mark";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * One full report card as returned by reports.getCard / reports.getForStudent
 * (both share the same validator, so either query feeds this view).
 */
export type ReportCardData = FunctionReturnType<typeof api.reports.getCard>;

/** "87.5٪" or a dash for a component with no data in the term. */
function pctOrDash(value: number | undefined): string {
  return value !== undefined
    ? t("reports.pct", { pct: formatNumber(value) })
    : "—";
}

function AttendanceTile({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-black tabular-nums", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

/**
 * The printable RTL term report — rendered identically in the admin preview
 * dialog, the portal detail screen and the browser's print/save-as-PDF sheet
 * (the `report-print` class is what the global @media print block targets).
 */
export function ReportCardView({ card }: { card: ReportCardData }) {
  return (
    <section
      dir="rtl"
      className="report-print flex flex-col gap-5 rounded-2xl border bg-card p-5 text-card-foreground md:p-6"
    >
      {/* School wordmark line */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-9" />
          <div className="flex flex-col">
            <span className="text-base leading-tight font-black">
              {t("common.appName")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("common.tagline")}
            </span>
          </div>
        </div>
        <span className="text-sm font-bold">{t("reports.cardTitle")}</span>
      </header>

      {/* Student + class + term */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          {t("reports.studentLabel")}
        </span>
        <span className="text-xl font-black">{card.studentName}</span>
        <span className="text-sm text-muted-foreground">
          {t("reports.classLabel")}: {card.className} · {t("reports.termLabel")}
          : {card.termName}
        </span>
      </div>

      {/* Subjects */}
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            {/* Final grade sits next to the subject so the headline number
                stays visible on narrow screens (the rest scrolls). */}
            <TableRow>
              <TableHead>{t("reports.colSubject")}</TableHead>
              <TableHead className="text-center">
                {t("reports.colFinalPct")}
              </TableHead>
              <TableHead className="text-center">
                {t("reports.colExamsPct")}
              </TableHead>
              <TableHead className="text-center">
                {t("reports.colHomeworkPct")}
              </TableHead>
              <TableHead className="text-center">
                {t("reports.colParticipationPct")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {card.subjects.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("reports.noSubjects")}
                </TableCell>
              </TableRow>
            ) : (
              card.subjects.map((subject) => (
                <TableRow key={subject.subjectId}>
                  <TableCell className="font-medium">
                    {subject.subjectName}
                  </TableCell>
                  <TableCell className="text-center font-bold tabular-nums">
                    {pctOrDash(subject.finalPct)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {pctOrDash(subject.examsPct)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {pctOrDash(subject.homeworkPct)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {pctOrDash(subject.participationPct)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Whole-class attendance summary */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">
          {t("reports.attendanceTitle")}
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <AttendanceTile
            label={t("reports.attPresent")}
            value={formatNumber(card.attendance.present)}
            valueClassName="text-success"
          />
          <AttendanceTile
            label={t("reports.attLate")}
            value={formatNumber(card.attendance.late)}
            valueClassName="text-accent-foreground"
          />
          <AttendanceTile
            label={t("reports.attAbsent")}
            value={formatNumber(card.attendance.absent)}
            valueClassName="text-destructive"
          />
          <AttendanceTile
            label={t("reports.attRate")}
            value={t("reports.pct", {
              pct: formatNumber(card.attendance.rate),
            })}
          />
        </div>
      </div>

      {/* Teacher remarks (only when set) */}
      {card.remarks !== undefined && card.remarks.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-xl border p-3">
          <span className="text-xs font-bold text-muted-foreground">
            {t("reports.remarksBlock")}
          </span>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {card.remarks}
          </p>
        </div>
      ) : null}

      {/* Signature / date footer */}
      <footer className="flex flex-col gap-4 border-t pt-4">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 text-sm">
          <span className="flex items-end gap-2">
            {t("reports.signature")}:
            <span
              aria-hidden
              className="inline-block w-36 border-b border-foreground/40"
            />
          </span>
          <span className="flex items-end gap-2">
            {t("reports.date")}:
            <span
              aria-hidden
              className="inline-block w-28 border-b border-foreground/40"
            />
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {card.publishedAt !== undefined
            ? t("reports.publishedAtLine", { date: formatDate(card.publishedAt) })
            : t("reports.computedAtLine", {
                date: formatDateTime(card.computedAt),
              })}
        </span>
      </footer>
    </section>
  );
}
