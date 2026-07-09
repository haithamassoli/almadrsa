"use client";

import { Component, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  ClipboardCheck,
  Download,
  Eye,
  Lock,
  Pencil,
  SearchX,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { numberString, useAppForm } from "@/components/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDateTime, formatNumber, t, type MessageKey } from "@/lib/i18n";
import { ExamStatusBadge } from "../exam-form";
import { mutationErrorText } from "../errors";

/** Row shape returned by api.exams.results. */
type ResultRow = {
  studentId: Id<"students">;
  studentName: string;
  attemptId?: Id<"examAttempts">;
  status: "not_started" | "in_progress" | "submitted";
  autoScore?: number;
  overrideScore?: number;
  effectiveScore?: number;
  gradingPending: boolean;
  submittedAt?: number;
  focusLossCount?: number; // M15 integrity signal
};

const ROW_BADGE: Record<
  ResultRow["status"],
  { labelKey: MessageKey; className?: string }
> = {
  not_started: { labelKey: "exams.rowNotStarted" },
  in_progress: {
    labelKey: "exams.rowInProgress",
    className: "border-transparent bg-accent text-accent-foreground",
  },
  submitted: {
    labelKey: "exams.rowSubmitted",
    className: "border-transparent bg-success/10 text-success",
  },
};

function RowStatusBadge({ status }: { status: ResultRow["status"] }) {
  const badge = ROW_BADGE[status];
  return (
    <Badge variant="outline" className={badge.className}>
      {t(badge.labelKey)}
    </Badge>
  );
}

/**
 * M15 — integrity signal: how many times the student left the exam page
 * while taking it. Muted at 0, accent up to 3, destructive-toned beyond;
 * a dash before the attempt starts.
 */
function FocusLossBadge({
  status,
  count,
}: {
  status: ResultRow["status"];
  count: number | undefined;
}) {
  if (status === "not_started") return <span>—</span>;
  const n = count ?? 0;
  const className =
    n === 0
      ? "border-transparent bg-muted text-muted-foreground"
      : n <= 3
        ? "border-transparent bg-accent text-accent-foreground"
        : "border-transparent bg-destructive/10 text-destructive";
  return (
    <Badge
      variant="outline"
      className={className}
      aria-label={t("exams.focusLossAria", { n: formatNumber(n) })}
    >
      <Eye aria-hidden />
      <span className="tabular-nums">{formatNumber(n)}</span>
    </Badge>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export default function ExamDetailPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId as Id<"exams">;
  return (
    // Keyed so navigating to another exam resets a caught failure.
    <ExamErrorBoundary key={examId}>
      <ExamView examId={examId} />
    </ExamErrorBoundary>
  );
}

/**
 * api.exams.get / results throw (not_found / validation) for missing,
 * foreign or malformed ids; convex/react rethrows during render, so a
 * boundary turns all of those into one friendly not-found state.
 */
class ExamErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <ExamNotFound />;
    return this.props.children;
  }
}

function ExamNotFound() {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{t("exams.notFoundTitle")}</EmptyTitle>
        <EmptyDescription>{t("exams.notFoundBody")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/teacher/exams" />}
        >
          <ArrowRight />
          {t("exams.backToList")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function ExamView({ examId }: { examId: Id<"exams"> }) {
  const router = useRouter();
  // Queries are skipped while deleting so the live subscriptions don't throw
  // not_found (rethrown in render) before the navigation away lands.
  const [removing, setRemoving] = useState(false);
  const exam = useQuery(api.exams.get, removing ? "skip" : { examId });
  const results = useQuery(api.exams.results, removing ? "skip" : { examId });
  // M8 — manual-grading worklist, only meaningful for exams that can hold
  // essays. M15: a versioned attempt samples its own set from the bank, so it
  // may include essays the fixed fallback list lacks — versioned exams always
  // consult the queue (the server counts essays per attempt).
  const examHasEssay =
    exam !== undefined &&
    (exam.questions.some((q) => q.type === "essay") ||
      (exam.versionRules?.length ?? 0) > 0);
  const gradingQueue = useQuery(
    api.exams.gradingQueue,
    removing || !examHasEssay ? "skip" : { examId },
  );

  const publishExam = useMutation(api.exams.publish);
  const closeExam = useMutation(api.exams.closeNow);
  const removeExam = useMutation(api.exams.remove);

  const [publishOpen, setPublishOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<ResultRow | null>(null);

  async function confirmPublish() {
    setActionPending(true);
    try {
      await publishExam({ examId });
      toast.success(t("exams.published"));
      setPublishOpen(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  async function confirmClose() {
    setActionPending(true);
    try {
      await closeExam({ examId });
      toast.success(t("exams.closedToast"));
      setCloseOpen(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  async function confirmDelete() {
    setActionPending(true);
    setRemoving(true);
    try {
      await removeExam({ examId });
      toast.success(t("exams.deleted"));
      router.push("/teacher/exams");
    } catch (error) {
      setRemoving(false);
      setActionPending(false);
      toast.error(mutationErrorText(error));
    }
  }

  // M15 — download the results table as an Excel-safe (BOM) CSV file.
  function exportResultsCsv() {
    if (exam === undefined || results === undefined) return;
    const csv = toCsv(
      results.rows.map((row) => ({
        student: row.studentName,
        status: t(ROW_BADGE[row.status].labelKey),
        score:
          row.status === "submitted" &&
          !row.gradingPending &&
          row.effectiveScore !== undefined
            ? row.effectiveScore
            : "",
        max: exam.totalMarks,
        submittedAt:
          row.submittedAt !== undefined ? formatDateTime(row.submittedAt) : "",
        focusLoss:
          row.status === "not_started" ? "" : (row.focusLossCount ?? 0),
      })),
      [
        { key: "student", label: t("exams.colStudent") },
        { key: "status", label: t("common.status") },
        { key: "score", label: t("exams.colScore") },
        { key: "max", label: t("exams.colTotalMarks") },
        { key: "submittedAt", label: t("exams.colSubmittedAt") },
        { key: "focusLoss", label: t("exams.colFocusLoss") },
      ],
    );
    downloadCsv(`${t("exams.csvFileName", { title: exam.title })}.csv`, csv);
  }

  if (exam === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 shrink-0"
          nativeButton={false}
          render={
            <Link href="/teacher/exams" aria-label={t("exams.backToList")} />
          }
        >
          <ArrowRight />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="heading-rule text-2xl font-black">{exam.title}</h1>
            <ExamStatusBadge status={exam.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 ps-3 text-sm text-muted-foreground">
            <span>
              {exam.className} · {exam.subjectName}
            </span>
            <span aria-hidden>·</span>
            <span>
              {formatDateTime(exam.windowStart)} —{" "}
              {formatDateTime(exam.windowEnd)}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t("exams.timeLimitMeta", {
                n: formatNumber(exam.timeLimitMinutes),
              })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t("exams.totalMarksMeta", { n: formatNumber(exam.totalMarks) })}
            </span>
          </p>
        </div>
      </div>

      {/* Actions by status */}
      {exam.status !== "closed" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {exam.status === "draft" ? (
              <>
                <Button onClick={() => setPublishOpen(true)}>
                  <Send />
                  {t("exams.publish")}
                </Button>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/teacher/exams/${examId}/edit`} />}
                >
                  <Pencil />
                  {t("common.edit")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                  {t("common.delete")}
                </Button>
              </>
            ) : (
              <Button variant="destructive" onClick={() => setCloseOpen(true)}>
                <Lock />
                {t("exams.closeNow")}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("exams.autoCloseNote", {
              time: formatDateTime(exam.windowEnd),
            })}
          </p>
        </div>
      ) : null}

      {/* M8 — manual-grading queue (essay exams only) */}
      {examHasEssay ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="font-bold">{t("exams.gradingQueueTitle")}</h2>
              {gradingQueue === undefined ? (
                <Skeleton className="h-4 w-40" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {gradingQueue.length > 0
                    ? t("exams.gradingPendingCount", {
                        n: formatNumber(gradingQueue.length),
                      })
                    : t("exams.gradingAllDone")}
                </p>
              )}
            </div>
            <Button
              variant={
                gradingQueue !== undefined && gradingQueue.length > 0
                  ? "default"
                  : "outline"
              }
              nativeButton={false}
              render={<Link href={`/teacher/exams/${examId}/grading`} />}
            >
              <ClipboardCheck />
              {t("exams.gradingOpen")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Live results */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{t("exams.resultsTitle")}</h2>
          {/* M15 — CSV export of the results table */}
          <Button
            variant="outline"
            size="sm"
            onClick={exportResultsCsv}
            disabled={results === undefined || results.rows.length === 0}
          >
            <Download />
            {t("exams.exportCsv")}
          </Button>
        </div>

        {results === undefined ? (
          <>
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
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full max-w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label={t("exams.statSubmitted")}
                value={`${formatNumber(results.stats.submitted)}/${formatNumber(
                  results.stats.enrolled,
                )}`}
              />
              <StatCard
                label={t("exams.statAvg")}
                value={
                  results.stats.avg === null
                    ? "—"
                    : formatNumber(round1(results.stats.avg))
                }
              />
              <StatCard
                label={t("exams.statMax")}
                value={
                  results.stats.max === null
                    ? "—"
                    : formatNumber(results.stats.max)
                }
              />
              <StatCard
                label={t("exams.statMin")}
                value={
                  results.stats.min === null
                    ? "—"
                    : formatNumber(results.stats.min)
                }
              />
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("exams.colStudent")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("exams.colScore")}</TableHead>
                    <TableHead>{t("exams.colFocusLoss")}</TableHead>
                    <TableHead>{t("exams.colSubmittedAt")}</TableHead>
                    <TableHead className="w-24 text-end">
                      <span className="sr-only">{t("common.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-muted-foreground"
                      >
                        {t("exams.noStudents")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.rows.map((row) => (
                      <TableRow key={row.studentId}>
                        <TableCell className="font-medium">
                          {row.studentName}
                        </TableCell>
                        <TableCell>
                          <RowStatusBadge status={row.status} />
                        </TableCell>
                        <TableCell>
                          {row.status === "submitted" && row.gradingPending ? (
                            <Badge className="border-transparent bg-accent text-accent-foreground">
                              {t("exams.pendingGradingBadge")}
                            </Badge>
                          ) : row.status === "submitted" &&
                            row.effectiveScore !== undefined ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="tabular-nums">
                                {formatNumber(row.effectiveScore)}/
                                {formatNumber(exam.totalMarks)}
                              </span>
                              {row.overrideScore !== undefined ? (
                                <Badge variant="outline">
                                  {t("exams.overriddenBadge")}
                                </Badge>
                              ) : null}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <FocusLossBadge
                            status={row.status}
                            count={row.focusLossCount}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.submittedAt !== undefined
                            ? formatDateTime(row.submittedAt)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-end">
                          {row.status === "submitted" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setOverrideTarget(row)}
                            >
                              {t("exams.overrideAction")}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      {/* Score override */}
      <Dialog
        open={overrideTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOverrideTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("exams.overrideTitle", {
                name: overrideTarget?.studentName ?? "",
              })}
            </DialogTitle>
          </DialogHeader>
          {overrideTarget !== null &&
          overrideTarget.attemptId !== undefined ? (
            <OverrideForm
              key={overrideTarget.attemptId}
              attemptId={overrideTarget.attemptId}
              initialScore={overrideTarget.effectiveScore}
              maxScore={exam.totalMarks}
              onClose={() => setOverrideTarget(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Publish confirm */}
      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("exams.publishConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("exams.publishConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionPending}
              onClick={confirmPublish}
            >
              {t("exams.publish")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close-now confirm */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("exams.closeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("exams.closeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionPending}
              onClick={confirmClose}
            >
              {t("exams.closeNow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("exams.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("exams.deleteConfirmBody", { title: exam.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionPending}
              onClick={confirmDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm" className="rounded-2xl">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-black tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}

function OverrideForm({
  attemptId,
  initialScore,
  maxScore,
  onClose,
}: {
  attemptId: Id<"examAttempts">;
  initialScore: number | undefined;
  maxScore: number;
  onClose: () => void;
}) {
  const overrideScore = useMutation(api.exams.overrideScore);
  const form = useAppForm({
    defaultValues: {
      score: initialScore !== undefined ? String(initialScore) : "",
      reason: "",
    },
    validators: {
      onSubmit: z.object({
        score: numberString({ min: 0, max: maxScore }),
        reason: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        await overrideScore({
          attemptId,
          score: Number(value.score),
          reason: value.reason.trim() || undefined,
        });
        toast.success(t("exams.overrideSaved"));
        onClose();
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <form.AppField name="score">
        {(field) => (
          <field.TextField
            label={t("exams.overrideScoreLabel", {
              max: formatNumber(maxScore),
            })}
            type="number"
            dir="ltr"
            min={0}
            max={maxScore}
            step="any"
          />
        )}
      </form.AppField>
      <form.AppField name="reason">
        {(field) => (
          <field.TextField
            label={t("exams.overrideReasonLabel")}
            maxLength={200}
          />
        )}
      </form.AppField>
      <DialogFooter className="mt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t("common.save")}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
