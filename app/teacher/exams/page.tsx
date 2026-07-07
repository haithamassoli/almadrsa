"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { ClipboardList, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { ExamStatusBadge } from "./exam-form";

export default function ExamsPage() {
  const router = useRouter();
  const exams = useQuery(api.exams.listMine, {});

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">{t("exams.title")}</h1>
        <Button
          nativeButton={false}
          render={<Link href="/teacher/exams/new" />}
        >
          <Plus />
          {t("exams.createExam")}
        </Button>
      </div>

      {exams !== undefined && exams.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>{t("exams.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("exams.emptyBody")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/teacher/exams/new" />}
            >
              <Plus />
              {t("exams.createExam")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("exams.colTitle")}</TableHead>
                <TableHead>{t("exams.colClass")}</TableHead>
                <TableHead>{t("exams.colSubject")}</TableHead>
                <TableHead>{t("exams.colWindow")}</TableHead>
                <TableHead>{t("exams.colDurationMinutes")}</TableHead>
                <TableHead>{t("exams.colTotalMarks")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("exams.colSubmitted")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams === undefined ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full max-w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                exams.map((exam) => (
                  <TableRow
                    key={exam._id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/teacher/exams/${exam._id}`)}
                  >
                    <TableCell className="max-w-56 font-medium">
                      <Link
                        href={`/teacher/exams/${exam._id}`}
                        className="line-clamp-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        aria-label={t("exams.openExam", { title: exam.title })}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {exam.title}
                      </Link>
                    </TableCell>
                    <TableCell>{exam.className}</TableCell>
                    <TableCell>{exam.subjectName}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(exam.windowStart)} —{" "}
                      {formatDateTime(exam.windowEnd)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatNumber(exam.timeLimitMinutes)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatNumber(exam.totalMarks)}
                    </TableCell>
                    <TableCell>
                      <ExamStatusBadge status={exam.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatNumber(exam.submittedCount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
