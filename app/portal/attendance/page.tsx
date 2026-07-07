"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Inbox } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";
import { cn } from "@/lib/utils";

// ——— Date helpers (local YYYY-MM-DD from Date parts, never UTC) ———

function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return localDateKey(d);
}

function defaultTo(): string {
  return localDateKey(new Date());
}

/** Parse a date-key at local midnight so formatDate renders the right day. */
function dateKeyMs(key: string): number {
  return new Date(`${key}T00:00:00`).getTime();
}

// ——— Presentational pieces (module scope) ———

const STATUS_BADGE: Record<
  "present" | "late" | "absent",
  { labelKey: MessageKey; className: string }
> = {
  present: {
    labelKey: "portal.statusPresent",
    className: "bg-success/10 text-success",
  },
  late: {
    labelKey: "portal.statusLate",
    className: "bg-accent text-accent-foreground",
  },
  absent: {
    labelKey: "portal.statusAbsent",
    className: "bg-destructive/10 text-destructive",
  },
};

function StatTile({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-black tabular-nums", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 4 }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full max-w-20" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ——— Page ———

export default function PortalAttendancePage() {
  const { sessionToken, ready } = useStudentSession();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const history = useQuery(
    api.portal.attendanceHistory,
    ready && sessionToken ? { sessionToken, from, to } : "skip",
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("portal.attendanceHistoryTitle")}
      </h1>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="portal-att-from">{t("portal.from")}</Label>
          <Input
            id="portal-att-from"
            type="date"
            dir="ltr"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="portal-att-to">{t("portal.to")}</Label>
          <Input
            id="portal-att-to"
            type="date"
            dir="ltr"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {history === undefined ? (
        <HistorySkeleton />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Totals */}
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              label={t("portal.statusPresent")}
              value={formatNumber(history.totals.present)}
              valueClassName="text-success"
            />
            <StatTile
              label={t("portal.statusLate")}
              value={formatNumber(history.totals.late)}
              valueClassName="text-accent-foreground"
            />
            <StatTile
              label={t("portal.statusAbsent")}
              value={formatNumber(history.totals.absent)}
              valueClassName="text-destructive"
            />
          </div>

          {history.rows.length === 0 ? (
            <Empty className="flex-1 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>{t("portal.attendanceEmptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("portal.attendanceEmptyBody")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("portal.colDate")}</TableHead>
                    <TableHead>{t("portal.colPeriod")}</TableHead>
                    <TableHead>{t("portal.colSubject")}</TableHead>
                    <TableHead>{t("portal.colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.rows.map((row, i) => {
                    const badge = STATUS_BADGE[row.status];
                    return (
                      <TableRow key={`${row.date}-${row.period}-${i}`}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {formatDate(dateKeyMs(row.date))}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatNumber(row.period)}
                        </TableCell>
                        <TableCell>{row.subjectName}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "border-transparent",
                              badge.className,
                            )}
                          >
                            {t(badge.labelKey)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
