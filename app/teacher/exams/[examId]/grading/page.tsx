"use client";

import { Component, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CircleCheck,
  ClipboardCheck,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { numberString, useAppForm } from "@/components/form";
import { AudioPlayer } from "@/components/audio-player";
import { VoiceRecorder } from "@/components/voice-recorder";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "../../errors";

/** Row shape returned by api.exams.gradingQueue. */
type QueueRow = {
  attemptId: Id<"examAttempts">;
  studentName: string;
  submittedAt?: number;
  essayCount: number;
  gradedCount: number;
};

/** Essay entry shape returned by api.exams.attemptForGrading. */
type EssayRow = {
  questionId: Id<"questions">;
  text: string;
  rubricText?: string;
  imageUrl?: string;
  marks: number;
  studentAnswer: string | null;
  currentScore?: number;
  currentFeedback: { text?: string; audioUrl?: string };
};

export default function GradingPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId as Id<"exams">;
  return (
    // Keyed so navigating to another exam resets a caught failure.
    <GradingErrorBoundary key={examId}>
      <GradingView examId={examId} />
    </GradingErrorBoundary>
  );
}

/**
 * api.exams.get / gradingQueue / attemptForGrading throw (not_found /
 * validation) for missing, foreign or malformed ids; convex/react rethrows
 * during render, so a boundary turns all of those into one friendly
 * not-found state.
 */
class GradingErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <GradingNotFound />;
    return this.props.children;
  }
}

function GradingNotFound() {
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

function GradingView({ examId }: { examId: Id<"exams"> }) {
  const exam = useQuery(api.exams.get, { examId });
  const queue = useQuery(api.exams.gradingQueue, { examId });
  // Explicit selection only — a just-completed attempt stays on screen with
  // its completion note even after its queue row disappears live.
  const [selectedId, setSelectedId] = useState<Id<"examAttempts"> | null>(
    null,
  );
  const detail = useQuery(
    api.exams.attemptForGrading,
    selectedId ? { attemptId: selectedId } : "skip",
  );

  if (exam === undefined || queue === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
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
            <Link
              href={`/teacher/exams/${examId}`}
              aria-label={t("exams.backToExam")}
            />
          }
        >
          <ArrowRight />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="heading-rule text-2xl font-black">
            {t("exams.gradingTitle")}
          </h1>
          <p className="ps-3 text-sm text-muted-foreground">
            {exam.title} · {exam.className} · {exam.subjectName}
          </p>
        </div>
      </div>

      {queue.length === 0 && selectedId === null ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>{t("exams.gradingQueueEmptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("exams.gradingQueueEmptyBody")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/teacher/exams/${examId}`} />}
            >
              <ArrowRight />
              {t("exams.backToExam")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[280px_1fr]">
          {/* Worklist */}
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-muted-foreground">
              {t("exams.gradingQueueHeading")}
            </h2>
            {queue.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                {t("exams.gradingAllDone")}
              </p>
            ) : (
              queue.map((row: QueueRow) => (
                <button
                  key={row.attemptId}
                  type="button"
                  onClick={() => setSelectedId(row.attemptId)}
                  aria-label={t("exams.gradingAttemptOf", {
                    name: row.studentName,
                  })}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border p-3 text-start transition-colors hover:bg-muted",
                    selectedId === row.attemptId &&
                      "border-primary bg-primary/5 hover:bg-primary/5",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {row.studentName}
                    </span>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {formatNumber(row.gradedCount)}/
                      {formatNumber(row.essayCount)}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.submittedAt !== undefined
                      ? formatDateTime(row.submittedAt)
                      : "—"}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Grading panel */}
          {selectedId === null ? (
            <p className="rounded-2xl border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">
              {t("exams.gradingSelectPrompt")}
            </p>
          ) : detail === undefined ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-6 w-48" />
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : (
            <AttemptPanel detail={detail} />
          )}
        </div>
      )}
    </div>
  );
}

function AttemptPanel({
  detail,
}: {
  detail: {
    attemptId: Id<"examAttempts">;
    examTitle: string;
    studentName: string;
    submittedAt?: number;
    gradedAt?: number;
    maxScore: number;
    autoScore?: number;
    autoMarks: number;
    essayMarks: number;
    essays: Array<EssayRow>;
  };
}) {
  // Combined total (matches the server: auto + Σ manual, 2-decimal round).
  const manualTotal = detail.essays.reduce(
    (sum, essay) => sum + (essay.currentScore ?? 0),
    0,
  );
  const total =
    Math.round(((detail.autoScore ?? 0) + manualTotal) * 100) / 100;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{detail.studentName}</h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {detail.submittedAt !== undefined ? (
            <>
              <span>{formatDateTime(detail.submittedAt)}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="tabular-nums">
            {t("exams.gradingAutoSummary", {
              score: formatNumber(detail.autoScore ?? 0),
              max: formatNumber(detail.autoMarks),
            })}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {t("exams.gradingEssaySummary", {
              n: formatNumber(detail.essayMarks),
            })}
          </span>
        </p>
      </div>

      {detail.gradedAt !== undefined ? (
        <Alert className="border-transparent bg-success/10 text-success">
          <CircleCheck />
          <AlertTitle>{t("exams.gradingCompleteNote")}</AlertTitle>
          <AlertDescription className="text-success/90">
            {t("exams.gradingFinalScore", {
              score: formatNumber(total),
              max: formatNumber(detail.maxScore),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {detail.essays.map((essay, index) => (
        <EssayGradeCard
          // Remount on attempt/question switch: state re-seeds from the row.
          key={`${detail.attemptId}:${essay.questionId}`}
          attemptId={detail.attemptId}
          essay={essay}
          index={index + 1}
        />
      ))}
    </div>
  );
}

function EssayGradeCard({
  attemptId,
  essay,
  index,
}: {
  attemptId: Id<"examAttempts">;
  essay: EssayRow;
  index: number;
}) {
  const gradeEssay = useMutation(api.exams.gradeEssay);
  const generateAudioUploadUrl = useMutation(
    api.files.generateFeedbackAudioUploadUrl,
  );

  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);

  const form = useAppForm({
    defaultValues: {
      score:
        essay.currentScore !== undefined ? String(essay.currentScore) : "",
      feedback: essay.currentFeedback.text ?? "",
    },
    validators: {
      onSubmit: z.object({
        score: numberString({ min: 0, max: essay.marks }),
        feedback: z.string().max(2000, t("common.invalidValue")),
      }),
    },
    onSubmit: async ({ value }) => {
      // Upload the fresh voice note first; omitting the id keeps the stored
      // one (server merge semantics).
      let feedbackAudioId: Id<"_storage"> | undefined;
      if (voiceBlob) {
        try {
          const uploadUrl = await generateAudioUploadUrl({});
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": voiceBlob.type || "audio/webm" },
            body: voiceBlob,
          });
          if (!response.ok) throw new Error("upload_failed");
          const { storageId } = (await response.json()) as {
            storageId: Id<"_storage">;
          };
          feedbackAudioId = storageId;
        } catch {
          toast.error(t("exams.voiceUploadError"));
          return;
        }
      }
      try {
        await gradeEssay({
          attemptId,
          questionId: essay.questionId,
          score: Number(value.score),
          // Always sent: whitespace-only clears the stored text (server-side).
          feedbackText: value.feedback,
          feedbackAudioId,
        });
        toast.success(t("exams.gradingSaved"));
        // The saved note now streams back as currentFeedback.audioUrl.
        setVoiceBlob(null);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold">
            {t("exams.gradingEssayTitle", { n: formatNumber(index) })}
          </h3>
          {essay.currentScore !== undefined ? (
            <Badge className="border-transparent bg-success/10 text-success">
              {t("exams.gradingGradedBadge")}
            </Badge>
          ) : null}
        </div>

        <p className="whitespace-pre-wrap font-medium">{essay.text}</p>
        {essay.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL; next/image remotePatterns not configured
          <img
            src={essay.imageUrl}
            alt={t("questions.imageAlt")}
            className="max-h-64 w-fit max-w-full rounded-xl border object-contain"
          />
        ) : null}

        {essay.rubricText ? (
          <div className="flex flex-col gap-1 rounded-xl bg-muted p-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t("exams.gradingRubric")}
            </span>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {essay.rubricText}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("exams.gradingStudentAnswer")}
          </span>
          <p className="whitespace-pre-wrap rounded-xl border p-3 text-sm">
            {essay.studentAnswer !== null &&
            essay.studentAnswer.trim().length > 0
              ? essay.studentAnswer
              : "—"}
          </p>
        </div>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-3"
        >
          {/* Escape-hatch fields keep per-question ids unique — several
              EssayGradeCard forms render at once, so the shared field
              components' id={field.name} would collide across cards. */}
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <form.AppField name="score">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched &&
                  field.state.meta.errors.length > 0;
                const first = field.state.meta.errors[0] as
                  | string
                  | { message?: string }
                  | undefined;
                const errorMessage =
                  typeof first === "string" ? first : first?.message;
                return (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`grade-score-${essay.questionId}`}>
                      {t("exams.gradingScoreLabel", {
                        max: formatNumber(essay.marks),
                      })}
                    </Label>
                    <Input
                      id={`grade-score-${essay.questionId}`}
                      type="number"
                      dir="ltr"
                      min={0}
                      max={essay.marks}
                      step="any"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      aria-invalid={invalid || undefined}
                    />
                    {invalid && errorMessage ? (
                      <p className="text-sm text-destructive">{errorMessage}</p>
                    ) : null}
                  </div>
                );
              }}
            </form.AppField>
            <form.AppField name="feedback">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`grade-feedback-${essay.questionId}`}>
                    {t("exams.gradingFeedbackLabel")}
                  </Label>
                  <Textarea
                    id={`grade-feedback-${essay.questionId}`}
                    rows={2}
                    maxLength={2000}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </div>
              )}
            </form.AppField>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("exams.gradingVoiceLabel")}
            </span>
            {essay.currentFeedback.audioUrl && voiceBlob === null ? (
              <AudioPlayer src={essay.currentFeedback.audioUrl} />
            ) : null}
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <VoiceRecorder
                  value={voiceBlob}
                  onChange={setVoiceBlob}
                  disabled={isSubmitting}
                />
              )}
            </form.Subscribe>
          </div>

          <form.AppForm>
            <form.SubmitButton className="self-start">
              {t("exams.gradingSave")}
            </form.SubmitButton>
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}
