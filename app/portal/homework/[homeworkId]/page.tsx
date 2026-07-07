"use client";

import { Component, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowRight,
  Award,
  CalendarClock,
  Check,
  CircleAlert,
  FileText,
  ImagePlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AudioPlayer } from "@/components/audio-player";
import { VoiceRecorder } from "@/components/voice-recorder";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";
import { cn } from "@/lib/utils";
import { errorCode, errorText, mutationErrorText } from "../errors";

type HomeworkView = FunctionReturnType<typeof api.homework.getForStudent>;
type SubmissionView = NonNullable<HomeworkView["submission"]>;

// Client mirrors of the homework.submit limits (server is the gate).
const MAX_TEXT_LENGTH = 8000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The closes-at line turns destructive under this much time left. */
const DUE_SOON_MS = 24 * 60 * 60 * 1000;

// ——— Presentational pieces (module scope) ———

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

/** Deep link to a homework the student cannot open: friendly full state. */
function RefusedState({ code }: { code: string }) {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlert />
        </EmptyMedia>
        <EmptyTitle>{t("homeworkPortal.cannotOpenTitle")}</EmptyTitle>
        <EmptyDescription>{errorText(code)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/portal/homework" />}
        >
          <ArrowRight />
          {t("homeworkPortal.backToHomework")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Renders getForStudent's render-time throws (not_found on a bad deep link)
 * as the refused state instead of the route error page.
 */
class QueryErrorBoundary extends Component<
  { children: ReactNode },
  { code: string | null }
> {
  state: { code: string | null } = { code: null };
  static getDerivedStateFromError(error: unknown): { code: string } {
    return { code: errorCode(error) ?? "unknown" };
  }
  render() {
    return this.state.code !== null ? (
      <RefusedState code={this.state.code} />
    ) : (
      this.props.children
    );
  }
}

/**
 * Square attachment tile. Image URLs render as thumbnails; PDFs (known from
 * the picked file's type, or discovered when the server URL fails to load
 * as an image) fall back to a document tile.
 */
function AttachmentThumb({ url, isPdf }: { url: string; isPdf: boolean }) {
  const [broken, setBroken] = useState(false);
  if (isPdf || broken) {
    return (
      <span className="flex size-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
        <FileText className="size-6" aria-hidden />
        <span className="text-[10px] font-medium">
          {t("homeworkPortal.pdfFile")}
        </span>
      </span>
    );
  }
  return (
    // Convex storage URLs are deployment-dynamic and next/image would need a
    // remotePatterns config — the plain element with native lazy loading is
    // the right tool here (same call as the exam question images).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={t("homeworkPortal.attachmentAlt")}
      loading="lazy"
      className="size-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

/** "درجتك": grade fraction + teacher feedback, once graded. */
function GradeCard({
  submission,
  marks,
}: {
  submission: SubmissionView;
  marks: number;
}) {
  if (submission.grade === undefined) return null;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <span className="text-sm text-muted-foreground">
        {t("homeworkPortal.gradeCardTitle")}
      </span>
      <span className="text-3xl font-black tabular-nums">
        {t("homeworkPortal.gradeFraction", {
          grade: formatNumber(submission.grade),
          total: formatNumber(marks),
        })}
      </span>
      {submission.feedbackText !== undefined ? (
        <div className="flex flex-col gap-1 border-t pt-3">
          <span className="text-xs font-bold text-muted-foreground">
            {t("homeworkPortal.teacherFeedbackTitle")}
          </span>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {submission.feedbackText}
          </p>
        </div>
      ) : null}
      {submission.gradedAt !== undefined ? (
        <span className="text-xs text-muted-foreground">
          {t("homeworkPortal.gradedAtLabel", {
            time: formatDateTime(submission.gradedAt),
          })}
        </span>
      ) : null}
    </div>
  );
}

/** Closed or graded: the student's submission, read-only. */
function SubmissionReadOnly({
  submission,
}: {
  submission: SubmissionView | null;
}) {
  if (submission === null) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        {t("homeworkPortal.noSubmissionYet")}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">
          {t("homeworkPortal.mySubmissionTitle")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("homeworkPortal.submittedAtLabel", {
            time: formatDateTime(submission.submittedAt),
          })}
        </span>
      </div>
      {submission.text !== undefined ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {submission.text}
        </p>
      ) : null}
      {submission.files.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {submission.files.map((file) => (
            <a
              key={file.id}
              href={file.url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("homeworkPortal.openAttachment")}
              className="relative aspect-square overflow-hidden rounded-xl border outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <AttachmentThumb url={file.url} isPdf={false} />
            </a>
          ))}
        </div>
      ) : null}
      {submission.audioUrl !== undefined ? (
        <AudioPlayer src={submission.audioUrl} />
      ) : null}
    </div>
  );
}

// ——— The submission editor (homework open, not graded yet) ———

/**
 * One attachment in the editor. New picks upload immediately (fileId lands
 * when the POST finishes) and preview via a local object URL; files kept
 * from the stored submission carry their signed server URL.
 */
type EditorAttachment = {
  key: string;
  fileId: Id<"_storage"> | null;
  url: string;
  isLocal: boolean;
  isPdf: boolean;
};

/**
 * Remounted (keyed on the submission's updatedAt) after every successful
 * save, so local previews are replaced by the stored submission's signed
 * URLs and edits always start from the server truth.
 */
function SubmissionEditor({
  sessionToken,
  homeworkId,
  submission,
}: {
  sessionToken: string;
  homeworkId: Id<"homework">;
  submission: SubmissionView | null;
}) {
  const generateUploadUrl = useMutation(api.files.generateSubmissionUploadUrl);
  const submitMutation = useMutation(api.homework.submit);

  const [text, setText] = useState(submission?.text ?? "");
  const [attachments, setAttachments] = useState<EditorAttachment[]>(() =>
    (submission?.files ?? []).map((file) => ({
      key: file.id,
      fileId: file.id,
      url: file.url,
      isLocal: false,
      isPdf: false,
    })),
  );
  // The stored voice note stays attached until removed or re-recorded.
  const [keptAudio, setKeptAudio] = useState<{
    id: Id<"_storage">;
    url: string;
  } | null>(() =>
    submission?.audioId !== undefined && submission.audioUrl !== undefined
      ? { id: submission.audioId, url: submission.audioUrl }
      : null,
  );
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [newAudioId, setNewAudioId] = useState<Id<"_storage"> | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const [pending, setPending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const keySeq = useRef(0);
  // Re-record can start a second upload while one is in flight — only the
  // latest sequence number may land its storage id.
  const voiceUploadSeq = useRef(0);

  // Unmount cleanup of local preview object URLs (external resources).
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.isLocal) URL.revokeObjectURL(attachment.url);
      }
    };
  }, []);

  async function uploadBlob(blob: Blob): Promise<Id<"_storage">> {
    const uploadUrl = await generateUploadUrl({ sessionToken });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!response.ok) throw new Error("upload_failed");
    const { storageId } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    return storageId;
  }

  async function uploadAttachment(key: string, file: File): Promise<void> {
    try {
      const storageId = await uploadBlob(file);
      setAttachments((prev) =>
        prev.map((attachment) =>
          attachment.key === key
            ? { ...attachment, fileId: storageId }
            : attachment,
        ),
      );
    } catch {
      toast.error(t("homeworkPortal.uploadFailed"));
      setAttachments((prev) => {
        const failed = prev.find((attachment) => attachment.key === key);
        if (failed?.isLocal) URL.revokeObjectURL(failed.url);
        return prev.filter((attachment) => attachment.key !== key);
      });
    }
  }

  function onPickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Reset so re-picking the same file fires onChange again.
    event.target.value = "";
    if (files.length === 0) return;
    let slots = MAX_FILES - attachments.length;
    const accepted: Array<{ key: string; file: File }> = [];
    for (const file of files) {
      if (
        !(file.type.startsWith("image/") || file.type === "application/pdf")
      ) {
        toast.error(t("homeworkPortal.fileInvalidType"));
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(t("homeworkPortal.fileTooLarge"));
        continue;
      }
      if (slots <= 0) {
        toast.error(t("homeworkPortal.tooManyFiles"));
        break;
      }
      slots -= 1;
      keySeq.current += 1;
      accepted.push({ key: `local-${keySeq.current}`, file });
    }
    if (accepted.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...accepted.map(({ key, file }) => ({
        key,
        fileId: null,
        url: URL.createObjectURL(file),
        isLocal: true,
        isPdf: file.type === "application/pdf",
      })),
    ]);
    for (const { key, file } of accepted) void uploadAttachment(key, file);
  }

  function removeAttachment(key: string) {
    setAttachments((prev) => {
      const removed = prev.find((attachment) => attachment.key === key);
      if (removed?.isLocal) URL.revokeObjectURL(removed.url);
      return prev.filter((attachment) => attachment.key !== key);
    });
  }

  async function uploadVoice(blob: Blob): Promise<void> {
    const seq = ++voiceUploadSeq.current;
    setAudioUploading(true);
    try {
      const storageId = await uploadBlob(blob);
      if (voiceUploadSeq.current === seq) setNewAudioId(storageId);
    } catch {
      if (voiceUploadSeq.current === seq) {
        toast.error(t("homeworkPortal.uploadFailed"));
        setVoiceBlob(null);
      }
    } finally {
      if (voiceUploadSeq.current === seq) setAudioUploading(false);
    }
  }

  function handleVoiceChange(blob: Blob | null) {
    setVoiceBlob(blob);
    setNewAudioId(null);
    if (blob === null) return;
    setKeptAudio(null); // the new recording replaces the stored voice note
    void uploadVoice(blob);
  }

  const uploadsBusy =
    audioUploading ||
    attachments.some((attachment) => attachment.fileId === null);
  const isUpdate = submission !== null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    const fileIds = attachments.flatMap((attachment) =>
      attachment.fileId !== null ? [attachment.fileId] : [],
    );
    const audioId =
      voiceBlob !== null ? (newAudioId ?? undefined) : keptAudio?.id;
    if (trimmed.length === 0 && fileIds.length === 0 && audioId === undefined) {
      toast.error(t("homeworkPortal.errEmptySubmission"));
      return;
    }
    setPending(true);
    try {
      await submitMutation({
        sessionToken,
        homeworkId,
        text: trimmed.length > 0 ? trimmed : undefined,
        fileIds,
        audioId,
      });
      toast.success(
        t(
          isUpdate
            ? "homeworkPortal.updatedToast"
            : "homeworkPortal.submittedToast",
        ),
      );
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-5 rounded-2xl border bg-card p-4"
    >
      {submission !== null ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-success">
          <Check className="size-3.5" aria-hidden />
          {t("homeworkPortal.submittedAtLabel", {
            time: formatDateTime(submission.submittedAt),
          })}
        </span>
      ) : null}

      {/* Text answer */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="submission-text">{t("homeworkPortal.textLabel")}</Label>
        <Textarea
          id="submission-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_TEXT_LENGTH}
          placeholder={t("homeworkPortal.textPlaceholder")}
          className="min-h-28"
          disabled={pending}
        />
      </div>

      {/* Photos / PDFs */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          {t("homeworkPortal.filesLabel")}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.key}
              className="relative aspect-square overflow-hidden rounded-xl border"
            >
              <AttachmentThumb url={attachment.url} isPdf={attachment.isPdf} />
              {attachment.fileId === null ? (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Spinner className="size-4" />
                </span>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => removeAttachment(attachment.key)}
                aria-label={t("homeworkPortal.removeFile")}
                className="absolute top-1 end-1 flex size-6 items-center justify-center rounded-full border bg-background/90 shadow-xs outline-none transition-colors hover:bg-background focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
          {attachments.length < MAX_FILES ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <ImagePlus className="size-5" aria-hidden />
              <span className="text-xs">{t("homeworkPortal.addFile")}</span>
            </button>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {t("homeworkPortal.filesHint")}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={onPickFiles}
        />
      </div>

      {/* Voice note */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          {t("homeworkPortal.voiceLabel")}
        </span>
        {keptAudio !== null && voiceBlob === null ? (
          <div className="flex items-center gap-2">
            <AudioPlayer src={keptAudio.url} className="min-w-0 flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-label={t("homeworkPortal.removeAudio")}
              onClick={() => setKeptAudio(null)}
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : null}
        <VoiceRecorder
          value={voiceBlob}
          onChange={handleVoiceChange}
          disabled={pending}
        />
        {audioUploading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            {t("homeworkPortal.uploading")}
          </span>
        ) : null}
      </div>

      <Button type="submit" disabled={pending || uploadsBusy}>
        {pending ? <Spinner /> : null}
        {t(isUpdate ? "homeworkPortal.updateCta" : "homeworkPortal.submitCta")}
      </Button>
    </form>
  );
}

// ——— The detail screen ———

function HomeworkDetail({
  sessionToken,
  homeworkId,
}: {
  sessionToken: string;
  homeworkId: Id<"homework">;
}) {
  const data = useQuery(api.homework.getForStudent, {
    sessionToken,
    homeworkId,
  });
  // Page-load timestamp — render-stable reference for the due-soon styling.
  const [now] = useState(() => Date.now());
  if (data === undefined) return <DetailSkeleton />;

  // Once graded the submission is settled — read-only even while still open.
  const graded = data.submission !== null && data.submission.grade !== undefined;
  const editable = data.canEdit && !graded;
  const dueSoon = data.canEdit && data.deadline - now < DUE_SOON_MS;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="heading-rule min-w-0 text-2xl font-black">
            {data.title}
          </h1>
          {!data.canEdit ? (
            <Badge variant="secondary" className="mt-1.5 shrink-0">
              {t("homeworkPortal.closedBadge")}
            </Badge>
          ) : null}
        </div>
        <span className="text-sm text-muted-foreground">
          {data.subjectName}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              dueSoon && "font-medium text-destructive",
            )}
          >
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            {t(
              data.canEdit ? "homeworkPortal.closesAt" : "homeworkPortal.closedAt",
              { time: formatDateTime(data.deadline) },
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Award className="size-3.5 shrink-0" aria-hidden />
            {t("homeworkPortal.marksTotal", {
              marks: formatNumber(data.marks),
            })}
          </span>
        </div>
      </div>

      {/* Assignment description */}
      {data.description !== undefined ? (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.description}
          </p>
        </div>
      ) : null}

      {graded && data.submission !== null ? (
        <GradeCard submission={data.submission} marks={data.marks} />
      ) : null}

      {editable ? (
        <SubmissionEditor
          // Remount after each save: local previews → stored signed URLs.
          key={data.submission?.updatedAt ?? "new"}
          sessionToken={sessionToken}
          homeworkId={homeworkId}
          submission={data.submission}
        />
      ) : (
        <SubmissionReadOnly submission={data.submission} />
      )}
    </div>
  );
}

export default function HomeworkDetailPage() {
  const params = useParams<{ homeworkId: string }>();
  const homeworkId = params.homeworkId as Id<"homework">;
  const { sessionToken, ready } = useStudentSession();
  if (!ready || !sessionToken) return <DetailSkeleton />;
  return (
    // Keyed so navigating between homework resets any caught error.
    <QueryErrorBoundary key={homeworkId}>
      <HomeworkDetail sessionToken={sessionToken} homeworkId={homeworkId} />
    </QueryErrorBoundary>
  );
}
