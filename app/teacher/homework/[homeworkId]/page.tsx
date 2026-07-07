"use client";

import { Component, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  Lock,
  Mic,
  Pencil,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AudioPlayer } from "@/components/audio-player";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "../errors";
import { HomeworkDialog, HomeworkStatusBadge } from "../homework-dialog";

type GradingDetail = FunctionReturnType<
  typeof api.homework.submissionForGrading
>;

export default function HomeworkDetailPage() {
  const params = useParams<{ homeworkId: string }>();
  const homeworkId = params.homeworkId as Id<"homework">;
  return (
    // Keyed so navigating to another homework resets a caught failure.
    <HomeworkErrorBoundary key={homeworkId}>
      <HomeworkView homeworkId={homeworkId} />
    </HomeworkErrorBoundary>
  );
}

/**
 * api.homework.submissions / submissionForGrading throw (not_found /
 * validation) for missing, foreign or malformed ids; convex/react rethrows
 * during render, so a boundary turns all of those into one friendly
 * not-found state.
 */
class HomeworkErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <HomeworkNotFound />;
    return this.props.children;
  }
}

function HomeworkNotFound() {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{t("homework.notFoundTitle")}</EmptyTitle>
        <EmptyDescription>{t("homework.notFoundBody")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/teacher/homework" />}
        >
          <ArrowRight />
          {t("homework.backToList")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function HomeworkView({ homeworkId }: { homeworkId: Id<"homework"> }) {
  const data = useQuery(api.homework.submissions, { homeworkId });
  const closeHomework = useMutation(api.homework.closeNow);

  const [closeOpen, setCloseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  // Explicit selection drives the grading sheet; the table updates live.
  const [gradingId, setGradingId] = useState<Id<"homeworkSubmissions"> | null>(
    null,
  );
  // Frozen at mount (render must stay pure) — deadline coloring only.
  const [now] = useState(() => Date.now());
  const gradingDetail = useQuery(
    api.homework.submissionForGrading,
    gradingId !== null ? { submissionId: gradingId } : "skip",
  );

  async function confirmClose() {
    setActionPending(true);
    try {
      await closeHomework({ homeworkId });
      toast.success(t("homework.closedToast"));
      setCloseOpen(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
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
      </div>
    );
  }

  const { homework, rows } = data;
  const deadlinePast = homework.deadline < now;

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
            <Link
              href="/teacher/homework"
              aria-label={t("homework.backToList")}
            />
          }
        >
          <ArrowRight />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="heading-rule text-2xl font-black">
              {homework.title}
            </h1>
            <HomeworkStatusBadge status={homework.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 ps-3 text-sm text-muted-foreground">
            <span>
              {homework.className} · {homework.subjectName}
            </span>
            <span aria-hidden>·</span>
            <span
              className={cn(
                "whitespace-nowrap",
                deadlinePast && "text-destructive",
              )}
            >
              {t("homework.deadlineMeta", {
                time: formatDateTime(homework.deadline),
              })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t("homework.marksMeta", { n: formatNumber(homework.marks) })}
            </span>
          </p>
          {homework.description ? (
            <p className="ps-3 text-sm whitespace-pre-wrap">
              {homework.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* Actions while open */}
      {homework.status === "open" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil />
              {t("common.edit")}
            </Button>
            <Button variant="destructive" onClick={() => setCloseOpen(true)}>
              <Lock />
              {t("homework.closeNow")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("homework.autoCloseNote", {
              time: formatDateTime(homework.deadline),
            })}
          </p>
        </div>
      ) : null}

      {/* Submissions */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">{t("homework.submissionsTitle")}</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("homework.colStudent")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("homework.colSubmittedAt")}</TableHead>
                <TableHead>{t("homework.colContent")}</TableHead>
                <TableHead>{t("homework.colGrade")}</TableHead>
                <TableHead className="w-24 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t("homework.noStudents")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.studentId}>
                    <TableCell className="font-medium">
                      {row.studentName}
                    </TableCell>
                    <TableCell>
                      {row.submissionId !== undefined ? (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-success/10 text-success"
                        >
                          {t("homework.submittedBadge")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                        >
                          {t("homework.notSubmittedBadge")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {row.updatedAt !== undefined
                        ? formatDateTime(row.updatedAt)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {row.submissionId === undefined ? (
                        "—"
                      ) : (
                        <span className="flex items-center gap-2.5 text-muted-foreground">
                          {row.hasText ? (
                            <span title={t("homework.contentText")}>
                              <FileText className="size-4" aria-hidden />
                              <span className="sr-only">
                                {t("homework.contentText")}
                              </span>
                            </span>
                          ) : null}
                          {row.fileCount > 0 ? (
                            <span
                              className="flex items-center gap-1 tabular-nums"
                              title={t("homework.contentImages", {
                                n: row.fileCount,
                              })}
                            >
                              <ImageIcon className="size-4" aria-hidden />
                              {formatNumber(row.fileCount)}
                              <span className="sr-only">
                                {t("homework.contentImages", {
                                  n: row.fileCount,
                                })}
                              </span>
                            </span>
                          ) : null}
                          {row.hasAudio ? (
                            <span title={t("homework.contentAudio")}>
                              <Mic className="size-4" aria-hidden />
                              <span className="sr-only">
                                {t("homework.contentAudio")}
                              </span>
                            </span>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.grade !== undefined
                        ? `${formatNumber(row.grade)}/${formatNumber(homework.marks)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      {row.submissionId !== undefined ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setGradingId(row.submissionId!)}
                        >
                          {t("homework.gradeAction")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Edit (open homework only) */}
      <HomeworkDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        homework={{
          homeworkId: homework._id,
          title: homework.title,
          description: homework.description,
          deadline: homework.deadline,
          marks: homework.marks,
          className: homework.className,
          subjectName: homework.subjectName,
        }}
      />

      {/* Close-now confirm */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("homework.closeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("homework.closeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionPending}
              onClick={confirmClose}
            >
              {t("homework.closeNow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Grading sheet */}
      <Sheet
        open={gradingId !== null}
        onOpenChange={(open) => {
          if (!open) setGradingId(null);
        }}
      >
        <SheetContent
          side="left"
          className="w-full gap-0 overflow-y-auto sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle>{t("homework.gradingTitle")}</SheetTitle>
            <SheetDescription>
              {gradingDetail !== undefined
                ? `${gradingDetail.studentName} · ${gradingDetail.homeworkTitle}`
                : t("common.loading")}
            </SheetDescription>
          </SheetHeader>
          {gradingDetail === undefined ? (
            <div className="flex flex-col gap-4 px-4 pb-4">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-10 w-32" />
            </div>
          ) : (
            <GradingPanel
              // Remount on submission switch: state re-seeds from the row.
              key={gradingDetail.submissionId}
              detail={gradingDetail}
              onDone={() => setGradingId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function GradingPanel({
  detail,
  onDone,
}: {
  detail: GradingDetail;
  onDone: () => void;
}) {
  const gradeSubmission = useMutation(api.homework.grade);
  const [score, setScore] = useState(
    detail.grade !== undefined ? String(detail.grade) : "",
  );
  const [feedback, setFeedback] = useState(detail.feedbackText ?? "");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await gradeSubmission({
        submissionId: detail.submissionId,
        grade: Number(score),
        // Always sent: whitespace-only clears the stored feedback.
        feedbackText: feedback,
      });
      toast.success(t("homework.gradeSaved"));
      onDone();
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("homework.submittedAtMeta", {
            time: formatDateTime(detail.submittedAt),
          })}
        </span>
        {detail.updatedAt !== detail.submittedAt ? (
          <>
            <span aria-hidden>·</span>
            <span>
              {t("homework.updatedAtMeta", {
                time: formatDateTime(detail.updatedAt),
              })}
            </span>
          </>
        ) : null}
        {detail.gradedAt !== undefined ? (
          <Badge className="border-transparent bg-success/10 text-success">
            {t("homework.gradedBadge")}
          </Badge>
        ) : null}
      </p>

      {detail.text !== undefined ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("homework.studentTextLabel")}
          </span>
          <p className="whitespace-pre-wrap rounded-xl border p-3 text-sm">
            {detail.text}
          </p>
        </div>
      ) : null}

      {detail.files.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("homework.attachmentsLabel")}
          </span>
          <div className="flex flex-wrap gap-2">
            {detail.files.map((file, index) => (
              <a
                key={file.id}
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label={t("homework.openAttachment", { n: index + 1 })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL; next/image remotePatterns not configured */}
                <img
                  src={file.url}
                  alt={t("homework.attachmentAlt", { n: index + 1 })}
                  loading="lazy"
                  className="size-20 rounded-lg border bg-muted object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {detail.audioUrl !== undefined ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("homework.audioLabel")}
          </span>
          <AudioPlayer src={detail.audioUrl} />
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hw-grade-score">
            {t("homework.gradeLabel", { max: formatNumber(detail.marks) })}
          </Label>
          <Input
            id="hw-grade-score"
            type="number"
            dir="ltr"
            required
            min={0}
            max={detail.marks}
            step="any"
            className="w-28"
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hw-grade-feedback">
            {t("homework.feedbackLabel")}
          </Label>
          <Textarea
            id="hw-grade-feedback"
            rows={3}
            maxLength={2000}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? <Spinner /> : null}
          {t("homework.saveGrade")}
        </Button>
      </form>
    </div>
  );
}
