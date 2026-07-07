"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ArrowLeft, CalendarRange, ClipboardList, Inbox } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ——— Date helpers (local YYYY-MM-DD, never toISOString which is UTC) ———

function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return localDateKey(d);
}

function defaultTo(): string {
  return localDateKey(new Date());
}

/** Parse a date-key at local midnight so formatDate renders the right day. */
function dateKeyMs(key: string): number {
  return new Date(`${key}T00:00:00`).getTime();
}

function attendanceRate(present: number, late: number, absent: number): number {
  const total = present + late + absent;
  return total === 0 ? 0 : Math.round((present / total) * 100);
}

// ——— Shared presentational pieces (module scope, not defined per-render) ———

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <Card size="sm" className="rounded-2xl">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("text-2xl font-black tabular-nums", className)}>
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function SummaryCards({
  present,
  late,
  absent,
}: {
  present: number;
  late: number;
  absent: number;
}) {
  const rate = attendanceRate(present, late, absent);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label={t("attendance.presentTotal")}
        value={formatNumber(present)}
        className="text-success"
      />
      <StatCard
        label={t("attendance.lateTotal")}
        value={formatNumber(late)}
        className="text-accent-foreground"
      />
      <StatCard
        label={t("attendance.absentTotal")}
        value={formatNumber(absent)}
        className="text-destructive"
      />
      <StatCard
        label={t("attendance.attendanceRate")}
        value={`${formatNumber(rate)}%`}
      />
    </div>
  );
}

function SummaryCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} size="sm" className="rounded-2xl">
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-12" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: columns }).map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full max-w-24" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CenteredEmpty({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const STATUS_BADGE: Record<
  "present" | "late" | "absent",
  { labelKey: "attendance.statusPresent" | "attendance.statusLate" | "attendance.statusAbsent"; className: string }
> = {
  present: {
    labelKey: "attendance.statusPresent",
    className: "bg-success/10 text-success",
  },
  late: {
    labelKey: "attendance.statusLate",
    className: "bg-accent text-accent-foreground",
  },
  absent: {
    labelKey: "attendance.statusAbsent",
    className: "bg-destructive/10 text-destructive",
  },
};

// ——— Tab: by class ———

function ByClassTab({
  classId,
  from,
  to,
}: {
  classId: Id<"classes"> | null;
  from: string;
  to: string;
}) {
  const lessons = useQuery(
    api.lessons.listForClass,
    classId ? { classId, from, to } : "skip",
  );

  if (!classId) {
    return (
      <CenteredEmpty
        icon={<CalendarRange />}
        title={t("attendance.pickClassTitle")}
        body={t("attendance.pickClassBody")}
      />
    );
  }

  if (lessons === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <SummaryCardsSkeleton />
        <TableSkeleton columns={7} />
      </div>
    );
  }

  const totals = lessons.reduce(
    (acc, lesson) => {
      acc.present += lesson.present;
      acc.late += lesson.late;
      acc.absent += lesson.absent;
      return acc;
    },
    { present: 0, late: 0, absent: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <SummaryCards {...totals} />
      {lessons.length === 0 ? (
        <CenteredEmpty
          icon={<Inbox />}
          title={t("attendance.noLessonsTitle")}
          body={t("attendance.noLessonsBody")}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("attendance.colDate")}</TableHead>
                <TableHead>{t("attendance.colPeriod")}</TableHead>
                <TableHead>{t("attendance.colSubject")}</TableHead>
                <TableHead className="text-center">
                  {t("attendance.colPresent")}
                </TableHead>
                <TableHead className="text-center">
                  {t("attendance.colLate")}
                </TableHead>
                <TableHead className="text-center">
                  {t("attendance.colAbsent")}
                </TableHead>
                <TableHead className="w-12 text-end">
                  <span className="sr-only">{t("attendance.openLesson")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.map((lesson) => (
                <TableRow key={lesson._id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {formatDate(dateKeyMs(lesson.date))}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatNumber(lesson.period)}
                  </TableCell>
                  <TableCell>{lesson.subjectName}</TableCell>
                  {lesson.total === 0 ? (
                    <TableCell
                      colSpan={3}
                      className="text-center text-muted-foreground"
                    >
                      {t("attendance.notRecorded")}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="text-center font-semibold tabular-nums text-success">
                        {formatNumber(lesson.present)}
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums text-accent-foreground">
                        {formatNumber(lesson.late)}
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums text-destructive">
                        {formatNumber(lesson.absent)}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      render={
                        <Link
                          href={`/teacher/lessons/${lesson._id}`}
                          aria-label={t("attendance.openLesson")}
                        />
                      }
                    >
                      <ArrowLeft />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ——— Tab: by student ———

function ByStudentTab({
  classId,
  from,
  to,
}: {
  classId: Id<"classes"> | null;
  from: string;
  to: string;
}) {
  const [studentId, setStudentId] = useState<Id<"students"> | null>(null);

  const students = useQuery(
    api.students.listStudents,
    classId ? { classId, status: "active" } : "skip",
  );
  const history = useQuery(
    api.attendance.historyForStudent,
    studentId ? { studentId, from, to } : "skip",
  );

  const studentItems = useMemo(
    () =>
      (students ?? []).map((s) => ({
        value: s._id as string,
        label: `${s.firstName} ${s.lastName}`,
      })),
    [students],
  );

  if (!classId) {
    return (
      <CenteredEmpty
        icon={<CalendarRange />}
        title={t("attendance.pickStudentTitle")}
        body={t("attendance.pickStudentBody")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label id="att-student-label">{t("attendance.studentLabel")}</Label>
        <Select
          items={studentItems}
          value={studentId}
          onValueChange={(value) =>
            setStudentId((value as Id<"students"> | null) ?? null)
          }
          disabled={students === undefined}
        >
          <SelectTrigger
            className="w-full"
            aria-labelledby="att-student-label"
          >
            <SelectValue placeholder={t("attendance.selectStudent")} />
          </SelectTrigger>
          <SelectContent>
            {studentItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!studentId ? (
        <CenteredEmpty
          icon={<ClipboardList />}
          title={t("attendance.pickStudentTitle")}
          body={t("attendance.pickStudentBody")}
        />
      ) : history === undefined ? (
        <div className="flex flex-col gap-4">
          <SummaryCardsSkeleton />
          <TableSkeleton columns={4} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <SummaryCards {...history.totals} />
          {history.rows.length === 0 ? (
            <CenteredEmpty
              icon={<Inbox />}
              title={t("attendance.noRecordsTitle")}
              body={t("attendance.noRecordsBody")}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("attendance.colDate")}</TableHead>
                    <TableHead>{t("attendance.colPeriod")}</TableHead>
                    <TableHead>{t("attendance.colSubject")}</TableHead>
                    <TableHead>{t("attendance.colStatus")}</TableHead>
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
                            className={cn("border-transparent", badge.className)}
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

// ——— Page ———

export default function AttendancePage() {
  const classes = useQuery(api.lessons.listMyClasses, {});
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("attendance.title")}
      </h1>

      {/* Shared controls: class + date range */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label id="att-class-label">{t("attendance.classLabel")}</Label>
          <Select
            items={classItems}
            value={classId}
            onValueChange={(value) =>
              setClassId((value as Id<"classes"> | null) ?? null)
            }
            disabled={classes === undefined}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="att-class-label"
            >
              <SelectValue placeholder={t("attendance.selectClass")} />
            </SelectTrigger>
            <SelectContent>
              {classItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="att-from">{t("attendance.from")}</Label>
          <Input
            id="att-from"
            type="date"
            dir="ltr"
            className="w-40"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="att-to">{t("attendance.to")}</Label>
          <Input
            id="att-to"
            type="date"
            dir="ltr"
            className="w-40"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <Tabs defaultValue="class">
        <TabsList>
          <TabsTrigger value="class">{t("attendance.tabByClass")}</TabsTrigger>
          <TabsTrigger value="student">
            {t("attendance.tabByStudent")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="class" className="mt-2">
          <ByClassTab classId={classId} from={from} to={to} />
        </TabsContent>
        <TabsContent value="student" className="mt-2">
          {/* Remount on class change so the student picker resets cleanly. */}
          <ByStudentTab
            key={classId ?? "none"}
            classId={classId}
            from={from}
            to={to}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
