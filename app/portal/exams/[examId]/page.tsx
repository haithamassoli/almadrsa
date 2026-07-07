"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, Check, CircleAlert, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";
import { cn } from "@/lib/utils";
import { errorCode, errorText, mutationErrorText } from "../errors";

type AttemptView = FunctionReturnType<typeof api.attempts.getAttempt>;
type AttemptQuestion = AttemptView["questions"][number];
type AnswerValue = string | boolean;
type AnswersMap = Record<Id<"questions">, AnswerValue>;

const SAVE_DEBOUNCE_MS = 800;
const WARN_MS = 5 * 60_000;

// ——— localStorage crash/offline buffer (full answers object per attempt) ———

function bufferKey(attemptId: string): string {
  return `attempt.${attemptId}.answers`;
}

function readBuffer(attemptId: string): Record<string, AnswerValue> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(bufferKey(attemptId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, AnswerValue> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" || typeof value === "boolean") {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeBuffer(attemptId: string, answers: AnswersMap): void {
  try {
    window.localStorage.setItem(bufferKey(attemptId), JSON.stringify(answers));
  } catch {
    // Quota/private mode: the debounced server save still runs.
  }
}

function clearBuffer(attemptId: string): void {
  try {
    window.localStorage.removeItem(bufferKey(attemptId));
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * Heights of the portal shell's sticky header and bottom nav, so the exam's
 * own sticky bars can pin right below/above them (measured — student names
 * can wrap the header taller than its nominal height).
 */
function useShellInsets(): { top: number; bottom: number } {
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const header = document.querySelector("header");
    const nav = document.querySelector("nav");
    const update = () => {
      setInsets((prev) => {
        const next = {
          top: header instanceof HTMLElement ? header.offsetHeight : 0,
          bottom: nav instanceof HTMLElement ? nav.offsetHeight : 0,
        };
        return next.top === prev.top && next.bottom === prev.bottom
          ? prev
          : next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (header) observer.observe(header);
    if (nav) observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  return insets;
}

// ——— Presentational pieces (module scope) ———

function TakeSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Skeleton className="h-12 rounded-2xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-40 rounded-2xl" />
      ))}
    </div>
  );
}

/** Deep link to an exam the student cannot open: friendly full-screen state. */
function RefusedState({ code }: { code: string }) {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlert />
        </EmptyMedia>
        <EmptyTitle>{t("examsPortal.cannotOpenTitle")}</EmptyTitle>
        <EmptyDescription>{errorText(code)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" render={<Link href="/portal/exams" />}>
          <ArrowRight />
          {t("examsPortal.backToExams")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Submitted attempt: the score card (no correct answers are ever shown). */
function ResultScreen({ attempt }: { attempt: AttemptView }) {
  const effective = attempt.overrideScore ?? attempt.autoScore ?? 0;
  return (
    <div className="flex flex-1 items-center justify-center py-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border bg-card p-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
          <Check className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col items-center gap-1">
          <span className="text-sm text-muted-foreground">
            {t("examsPortal.resultLabel")}
          </span>
          <span className="text-4xl font-black tabular-nums">
            {t("examsPortal.scoreFraction", {
              score: formatNumber(effective),
              total: formatNumber(attempt.maxScore),
            })}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-bold">{attempt.examTitle}</span>
          {attempt.submittedAt !== undefined ? (
            <span className="text-xs text-muted-foreground">
              {t("examsPortal.submittedAtLabel", {
                time: formatDateTime(attempt.submittedAt),
              })}
            </span>
          ) : null}
        </div>
        <Button
          variant="outline"
          className="w-full"
          render={<Link href="/portal/exams" />}
        >
          <ArrowRight />
          {t("examsPortal.backToExams")}
        </Button>
      </div>
    </div>
  );
}

/** mm:ss to the deadline; destructive under 5 minutes; fires onExpire at 0. */
function CountdownTimer({
  deadlineAt,
  onExpire,
}: {
  deadlineAt: number;
  onExpire: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, deadlineAt - Date.now()),
  );
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });
  const firedRef = useRef(false);
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, deadlineAt - Date.now());
      setRemainingMs(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return (
    <span
      dir="ltr"
      aria-label={t("examsPortal.timeLeft")}
      className={cn(
        "shrink-0 font-mono text-sm font-bold tabular-nums",
        remainingMs < WARN_MS && "text-destructive",
      )}
    >
      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </span>
  );
}

function SaveIndicator({ state }: { state: "saved" | "saving" }) {
  return state === "saving" ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <Spinner className="size-3" />
      {t("examsPortal.saving")}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success">
      <Check className="size-3.5" aria-hidden />
      {t("examsPortal.saved")}
    </span>
  );
}

function McqOptions({
  question,
  value,
  onAnswer,
}: {
  question: AttemptQuestion;
  value: string | undefined;
  onAnswer: (questionId: Id<"questions">, value: AnswerValue) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {question.options.map((option) => {
        const selected = value === option.id;
        return (
          <label
            key={option.id}
            className={cn(
              "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
              "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            <input
              type="radio"
              name={question.questionId}
              className="sr-only"
              checked={selected}
              onChange={() => onAnswer(question.questionId, option.id)}
            />
            <span
              aria-hidden
              className={cn(
                "flex size-4.5 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary" : "border-input",
              )}
            >
              {selected ? (
                <span className="size-2.5 rounded-full bg-primary" />
              ) : null}
            </span>
            <span className="text-sm leading-relaxed">{option.text}</span>
          </label>
        );
      })}
    </div>
  );
}

function TrueFalseOptions({
  question,
  value,
  onAnswer,
}: {
  question: AttemptQuestion;
  value: boolean | undefined;
  onAnswer: (questionId: Id<"questions">, value: AnswerValue) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {([true, false] as const).map((bool) => {
        const selected = value === bool;
        return (
          <button
            key={String(bool)}
            type="button"
            aria-pressed={selected}
            onClick={() => onAnswer(question.questionId, bool)}
            className={cn(
              "flex min-h-12 items-center justify-center rounded-xl border text-sm font-semibold transition-colors outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? "border-primary bg-primary/5 text-primary"
                : "hover:bg-muted/50",
            )}
          >
            {bool ? t("examsPortal.optionTrue") : t("examsPortal.optionFalse")}
          </button>
        );
      })}
    </div>
  );
}

function QuestionCard({
  question,
  index,
  value,
  onAnswer,
}: {
  question: AttemptQuestion;
  index: number;
  value: AnswerValue | undefined;
  onAnswer: (questionId: Id<"questions">, value: AnswerValue) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="sr-only">
          {t("examsPortal.questionNumber", { n: index + 1 })}
        </span>
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary tabular-nums"
        >
          {formatNumber(index + 1)}
        </span>
        <Badge variant="outline" className="shrink-0">
          {question.marks === 1
            ? t("examsPortal.markOne")
            : t("examsPortal.markMany", { n: formatNumber(question.marks) })}
        </Badge>
      </div>
      <p className="font-medium leading-relaxed">{question.text}</p>
      {question.type === "mcq" ? (
        <McqOptions
          question={question}
          value={typeof value === "string" ? value : undefined}
          onAnswer={onAnswer}
        />
      ) : (
        <TrueFalseOptions
          question={question}
          value={typeof value === "boolean" ? value : undefined}
          onAnswer={onAnswer}
        />
      )}
    </div>
  );
}

// ——— The taking screen (attempt is in_progress) ———

function TakingScreen({
  sessionToken,
  attemptId,
  attempt,
}: {
  sessionToken: string;
  attemptId: Id<"examAttempts">;
  attempt: AttemptView;
}) {
  const saveAnswersMutation = useMutation(api.attempts.saveAnswers);
  const submitMutation = useMutation(api.attempts.submit);
  const insets = useShellInsets();

  // One-time init: server answers overlaid with locally buffered answers the
  // server never received (crash/offline recovery). Server wins on conflict.
  const [initial] = useState(() => {
    const validIds = new Set<string>(
      attempt.questions.map((question) => question.questionId),
    );
    const buffered = readBuffer(attemptId);
    const missing: AnswersMap = {};
    for (const [key, value] of Object.entries(buffered)) {
      if (validIds.has(key) && !(key in attempt.answers)) {
        missing[key as Id<"questions">] = value;
      }
    }
    return { merged: { ...attempt.answers, ...missing }, missing };
  });

  const [answers, setAnswersState] = useState<AnswersMap>(initial.merged);
  const [saveState, setSaveState] = useState<"saved" | "saving">(
    Object.keys(initial.missing).length > 0 ? "saving" : "saved",
  );
  const [timeUp, setTimeUp] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);

  const answersRef = useRef(initial.merged);
  const pendingRef = useRef<AnswersMap>({});
  const timerRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const finalizedRef = useRef(false);

  /**
   * Push the pending answer batch now. On failure the batch is re-queued
   * (newer local edits win) so a later flush retries it; attempt_expired
   * hands over to finalize.
   */
  async function flushSave(): Promise<void> {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (lockedRef.current) return;
    const batch = pendingRef.current;
    if (Object.keys(batch).length === 0) return;
    pendingRef.current = {};
    try {
      await saveAnswersMutation({ sessionToken, attemptId, answers: batch });
      if (Object.keys(pendingRef.current).length === 0) setSaveState("saved");
    } catch (error) {
      pendingRef.current = { ...batch, ...pendingRef.current };
      if (errorCode(error) === "attempt_expired") {
        void finalizeRef.current(false);
      } else {
        toast.error(mutationErrorText(error));
      }
    }
  }

  /**
   * Time is up (client timer, or the server said attempt_expired): lock the
   * form, show the time-up state and submit. The reactive getAttempt then
   * flips to "submitted" and the result screen replaces all of this.
   */
  async function finalize(flushFirst: boolean): Promise<void> {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    setTimeUp(true);
    setConfirmOpen(false);
    if (flushFirst) await flushRef.current(); // still inside the save grace
    lockedRef.current = true;
    try {
      await submitMutation({ sessionToken, attemptId });
      clearBuffer(attemptId);
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  }

  // flushSave/finalize close over fresh state each render; timers and DOM
  // listeners go through these refs so they always call the latest version.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const finalizeRef = useRef<(flushFirst: boolean) => Promise<void>>(
    async () => {},
  );
  useEffect(() => {
    flushRef.current = flushSave;
    finalizeRef.current = finalize;
  });

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const handleAnswer = useCallback(
    (questionId: Id<"questions">, value: AnswerValue) => {
      if (lockedRef.current) return;
      const next = { ...answersRef.current, [questionId]: value };
      answersRef.current = next;
      setAnswersState(next);
      writeBuffer(attemptId, next);
      pendingRef.current = { ...pendingRef.current, [questionId]: value };
      setSaveState("saving");
      scheduleFlush();
    },
    [attemptId, scheduleFlush],
  );

  // Recovered buffered answers: push them once, then drop the buffer copy
  // (it is rewritten in full on the next edit anyway).
  const overlayPushedRef = useRef(false);
  useEffect(() => {
    if (overlayPushedRef.current) return;
    overlayPushedRef.current = true;
    if (Object.keys(initial.missing).length === 0) return;
    pendingRef.current = { ...initial.missing, ...pendingRef.current };
    void (async () => {
      await flushRef.current();
      if (Object.keys(pendingRef.current).length === 0) clearBuffer(attemptId);
    })();
  }, [attemptId, initial.missing]);

  // Flush pending answers when the tab hides, the page unloads, or the
  // student navigates away in-app.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    const onPagehide = () => void flushRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPagehide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPagehide);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void flushRef.current();
    };
  }, []);

  const handleExpire = useCallback(() => {
    void finalizeRef.current(true);
  }, []);

  async function confirmSubmit(): Promise<void> {
    setSubmitPending(true);
    try {
      await flushRef.current();
      if (finalizedRef.current) return; // time ran out mid-flush
      lockedRef.current = true;
      await submitMutation({ sessionToken, attemptId });
      clearBuffer(attemptId);
      setConfirmOpen(false);
      toast.success(t("examsPortal.submittedToast"));
    } catch (error) {
      lockedRef.current = false;
      toast.error(mutationErrorText(error));
    } finally {
      setSubmitPending(false);
    }
  }

  const total = attempt.questions.length;
  const answered = attempt.questions.reduce(
    (count, question) => count + (question.questionId in answers ? 1 : 0),
    0,
  );
  const unanswered = total - answered;

  if (timeUp) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border bg-card p-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Hourglass className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-black">
            {t("examsPortal.timeUpTitle")}
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {t("examsPortal.timeUpBody")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Sticky exam bar: title + countdown + autosave state */}
      <div
        className="sticky z-10 flex items-center gap-3 rounded-2xl border bg-background/95 px-3 py-2.5 backdrop-blur"
        style={{ top: insets.top + 8 }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {attempt.examTitle}
        </span>
        <CountdownTimer
          deadlineAt={attempt.deadlineAt}
          onExpire={handleExpire}
        />
        <SaveIndicator state={saveState} />
      </div>

      {/* Questions in exam order */}
      <div className="flex flex-col gap-4">
        {attempt.questions.map((question, index) => (
          <QuestionCard
            key={question.questionId}
            question={question}
            index={index}
            value={answers[question.questionId]}
            onAnswer={handleAnswer}
          />
        ))}
      </div>

      {/* Sticky submit bar */}
      <div
        className="sticky z-10 mt-auto flex items-center justify-between gap-3 rounded-2xl border bg-background/95 px-3 py-2.5 backdrop-blur"
        style={{ bottom: insets.bottom + 8 }}
      >
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("examsPortal.answeredCounter", {
            answered: formatNumber(answered),
            total: formatNumber(total),
          })}
        </span>
        <Button onClick={() => setConfirmOpen(true)} disabled={submitPending}>
          {t("examsPortal.submitCta")}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("examsPortal.submitConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {unanswered > 0
                ? t("examsPortal.submitConfirmUnanswered", {
                    n: formatNumber(unanswered),
                  })
                : t("examsPortal.submitConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submitPending}
              onClick={() => void confirmSubmit()}
            >
              {submitPending ? <Spinner /> : null}
              {t("examsPortal.submitCta")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ——— Page: start (or resume) the attempt, then route to the right screen ———

function TakeExamInner({
  examId,
  sessionToken,
  ready,
}: {
  examId: Id<"exams">;
  sessionToken: string | null;
  ready: boolean;
}) {
  const startMutation = useMutation(api.attempts.start);
  const [attemptId, setAttemptId] = useState<Id<"examAttempts"> | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const startedRef = useRef(false);
  useEffect(() => {
    if (!ready || !sessionToken || startedRef.current) return;
    startedRef.current = true;
    startMutation({ sessionToken, examId })
      .then((result) => setAttemptId(result.attemptId))
      .catch((error: unknown) => setStartError(errorCode(error) ?? "unknown"));
  }, [ready, sessionToken, examId, startMutation]);

  // start refuses once the window is over — but the student may still have a
  // submitted attempt to review. Look it up through the list query and use it
  // directly (derived, not synced into state).
  const fallbackList = useQuery(
    api.attempts.listForStudent,
    startError === "exam_not_open" && sessionToken ? { sessionToken } : "skip",
  );
  const fallbackAttemptId =
    startError === "exam_not_open"
      ? fallbackList?.find((row) => row.examId === examId)?.attemptId
      : undefined;
  const effectiveAttemptId = attemptId ?? fallbackAttemptId ?? null;

  const attempt = useQuery(
    api.attempts.getAttempt,
    sessionToken && effectiveAttemptId
      ? { sessionToken, attemptId: effectiveAttemptId }
      : "skip",
  );

  // The attempt may get auto-submitted while this client was away — tidy up
  // any leftover local buffer once it is submitted.
  const submitted = attempt?.status === "submitted";
  useEffect(() => {
    if (submitted && effectiveAttemptId) clearBuffer(effectiveAttemptId);
  }, [submitted, effectiveAttemptId]);

  if (!ready || !sessionToken) return <TakeSkeleton />;

  if (effectiveAttemptId === null && startError !== null) {
    // Window over: keep the skeleton while checking for a reviewable attempt.
    if (startError === "exam_not_open" && fallbackList === undefined) {
      return <TakeSkeleton />;
    }
    return <RefusedState code={startError} />;
  }

  if (effectiveAttemptId === null || attempt === undefined) {
    return <TakeSkeleton />;
  }

  if (attempt.status === "submitted") return <ResultScreen attempt={attempt} />;

  return (
    <TakingScreen
      key={effectiveAttemptId}
      sessionToken={sessionToken}
      attemptId={effectiveAttemptId}
      attempt={attempt}
    />
  );
}

export default function TakeExamPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId as Id<"exams">;
  const { sessionToken, ready } = useStudentSession();
  // Keyed so navigating to a different exam resets the start-once machinery.
  return (
    <TakeExamInner
      key={examId}
      examId={examId}
      sessionToken={sessionToken}
      ready={ready}
    />
  );
}
