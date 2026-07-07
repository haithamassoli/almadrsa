"use client";

import { Component, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  ExternalLink,
  Plus,
  QrCode,
  SearchX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "../../errors";
import { QrDialog } from "./qr-dialog";

type Status = "present" | "absent" | "late";
type Resource = { title: string; url: string };

/** Shape returned by api.lessons.get. */
type LessonDetail = {
  _id: Id<"lessons">;
  date: string;
  period: number;
  source: "timetable" | "adhoc";
  title?: string;
  notes?: string;
  resources: Resource[];
  className: string;
  subjectName: string;
  classId: Id<"classes">;
};

/** Row shape returned by api.attendance.roster. */
type RosterRow = {
  studentId: Id<"students">;
  firstName: string;
  lastName: string;
  status: Status | null;
};

const MAX_RESOURCES = 10;

export default function LessonPage() {
  const params = useParams<{ lessonId: string }>();
  const lessonId = params.lessonId as Id<"lessons">;
  return (
    // Keyed so navigating to another lesson resets a caught failure.
    <LessonErrorBoundary key={lessonId}>
      <LessonView lessonId={lessonId} />
    </LessonErrorBoundary>
  );
}

/**
 * api.lessons.get throws (not_found / validation) for missing, foreign or
 * malformed ids; convex/react rethrows during render, so a boundary turns
 * all of those into one friendly not-found state.
 */
class LessonErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <LessonNotFound />;
    return this.props.children;
  }
}

function LessonNotFound() {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{t("lessons.notFoundTitle")}</EmptyTitle>
        <EmptyDescription>{t("lessons.notFoundBody")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/teacher" />}
        >
          <ArrowRight />
          {t("lessons.backToToday")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function LessonView({ lessonId }: { lessonId: Id<"lessons"> }) {
  const lesson = useQuery(api.lessons.get, { lessonId });

  if (lesson === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-80 rounded-2xl" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      </div>
    );
  }

  // "YYYY-MM-DD" parsed as local midnight (bare date strings would be UTC).
  const dateMs = new Date(`${lesson.date}T00:00:00`).getTime();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 shrink-0"
          nativeButton={false}
          render={
            <Link href="/teacher" aria-label={t("lessons.backToToday")} />
          }
        >
          <ArrowRight />
        </Button>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="heading-rule text-2xl font-black">
            {lesson.subjectName} — {lesson.className}
          </h1>
          <div className="flex flex-wrap items-center gap-2 ps-3 text-sm text-muted-foreground">
            <span>{formatDate(dateMs)}</span>
            <Badge variant="outline" className="tabular-nums">
              {t("lessons.periodBadge", { period: lesson.period })}
            </Badge>
            {lesson.source === "adhoc" ? (
              <Badge variant="secondary">{t("lessons.adhocBadge")}</Badge>
            ) : null}
            {lesson.title ? (
              <span className="truncate">{lesson.title}</span>
            ) : null}
          </div>
        </div>
      </div>

      <AttendanceCard lessonId={lessonId} />

      <div className="grid items-start gap-6 md:grid-cols-2">
        <ResourcesCard lesson={lesson} />
        <NotesCard lesson={lesson} />
      </div>
    </div>
  );
}

// ——— Attendance ———

const STATUSES: readonly Status[] = ["present", "late", "absent"];

const STATUS_LABEL_KEY = {
  present: "lessons.present",
  late: "lessons.late",
  absent: "lessons.absent",
} as const;

const STATUS_SELECTED_CLASS: Record<Status, string> = {
  present: "border-success bg-success/15 text-success",
  late: "border-accent-foreground/50 bg-accent text-accent-foreground",
  absent: "border-destructive/50 bg-destructive/10 text-destructive",
};

function AttendanceCard({ lessonId }: { lessonId: Id<"lessons"> }) {
  const roster = useQuery(api.attendance.roster, { lessonId });
  const bulkMark = useMutation(api.attendance.bulkMark);
  // Local overrides on top of the live server roster; effective status is
  // edits[id] ?? server status, so concurrent refreshes stay consistent.
  const [edits, setEdits] = useState<Record<string, Status>>({});
  const [pending, setPending] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const rows = roster ?? [];
  const dirtyCount = rows.reduce((count, row) => {
    const edit = edits[row.studentId];
    return edit !== undefined && edit !== row.status ? count + 1 : count;
  }, 0);
  const effectiveMarked = rows.reduce(
    (count, row) =>
      (edits[row.studentId] ?? row.status) !== null ? count + 1 : count,
    0,
  );

  function setStatus(studentId: Id<"students">, status: Status) {
    setEdits((prev) => ({ ...prev, [studentId]: status }));
  }

  function markAllPresent() {
    setEdits(
      Object.fromEntries(
        rows.map((row) => [row.studentId, "present" as const]),
      ),
    );
  }

  async function save() {
    const entries = rows.flatMap((row) => {
      const status = edits[row.studentId] ?? row.status;
      return status === null ? [] : [{ studentId: row.studentId, status }];
    });
    setPending(true);
    try {
      await bulkMark({ lessonId, entries });
      toast.success(t("lessons.attendanceSaved"));
      setEdits({});
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("lessons.attendanceTitle")}</CardTitle>
        {rows.length > 0 ? (
          <CardDescription className="tabular-nums">
            {t("lessons.attendanceProgress", {
              marked: effectiveMarked,
              enrolled: rows.length,
            })}
          </CardDescription>
        ) : null}
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQrOpen(true)}
          >
            <QrCode />
            {t("checkin.qrButton")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        {/* Toolbar: the fast path is mark-all → save, both in thumb reach. */}
        <div className="flex flex-wrap items-center gap-2 px-4">
          <Button
            variant="outline"
            size="sm"
            onClick={markAllPresent}
            disabled={rows.length === 0}
          >
            {t("lessons.markAllPresent")}
          </Button>
          {dirtyCount > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("lessons.unsavedChanges", { count: dirtyCount })}
            </span>
          ) : null}
          <Button
            size="sm"
            className="ms-auto"
            disabled={dirtyCount === 0 || pending}
            onClick={() => void save()}
          >
            {pending ? <Spinner /> : null}
            {t("lessons.saveAttendance")}
          </Button>
        </div>
        <div className="flex flex-col divide-y border-t">
          {roster === undefined ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex min-h-12 items-center gap-2 px-4 py-1.5"
              >
                <Skeleton className="h-4 w-full max-w-40" />
                <Skeleton className="ms-auto h-9 w-44 shrink-0 rounded-lg" />
              </div>
            ))
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("lessons.rosterEmpty")}
            </p>
          ) : (
            rows.map((row) => (
              <RosterRowItem
                key={row.studentId}
                row={row}
                effective={edits[row.studentId] ?? row.status}
                onSet={setStatus}
              />
            ))
          )}
        </div>
      </CardContent>
      <QrDialog open={qrOpen} onOpenChange={setQrOpen} lessonId={lessonId} />
    </Card>
  );
}

function RosterRowItem({
  row,
  effective,
  onSet,
}: {
  row: RosterRow;
  effective: Status | null;
  onSet: (studentId: Id<"students">, status: Status) => void;
}) {
  const name = `${row.firstName} ${row.lastName}`;
  return (
    <div className="flex min-h-12 items-center gap-2 px-4 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {name}
      </span>
      <div
        className="flex shrink-0 items-center gap-1"
        role="group"
        aria-label={t("lessons.attendanceOf", { name })}
      >
        {STATUSES.map((status) => (
          <StatusButton
            key={status}
            status={status}
            selected={effective === status}
            onSelect={() => onSet(row.studentId, status)}
          />
        ))}
      </div>
    </div>
  );
}

function StatusButton({
  status,
  selected,
  onSelect,
}: {
  status: Status;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "h-9 min-w-13 rounded-lg border px-2 text-xs font-medium transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-w-16 sm:text-sm",
        selected
          ? STATUS_SELECTED_CLASS[status]
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {t(STATUS_LABEL_KEY[status])}
    </button>
  );
}

// ——— Resources ———

function ResourcesCard({ lesson }: { lesson: LessonDetail }) {
  const updateLesson = useMutation(api.lessons.updateLesson);
  const [addOpen, setAddOpen] = useState(false);
  // One removal at a time: each call replaces the whole array, so a second
  // tap on a stale list would resurrect the first removed row.
  const [removePending, setRemovePending] = useState(false);

  async function removeResource(index: number) {
    setRemovePending(true);
    try {
      await updateLesson({
        lessonId: lesson._id,
        resources: lesson.resources.filter((_, i) => i !== index),
      });
      toast.success(t("lessons.resourceRemoved"));
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setRemovePending(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("lessons.resourcesTitle")}</CardTitle>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={lesson.resources.length >= MAX_RESOURCES}
          >
            <Plus />
            {t("lessons.addResource")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {lesson.resources.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t("lessons.resourcesEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {lesson.resources.map((resource, index) => (
              <li
                key={`${resource.url}-${index}`}
                className="flex min-h-12 items-center gap-2 py-1.5"
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    }
                  >
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{resource.title}</span>
                  </TooltipTrigger>
                  <TooltipContent dir="ltr">{resource.url}</TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={t("lessons.removeResource")}
                  disabled={removePending}
                  onClick={() => void removeResource(index)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AddResourceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        lesson={lesson}
      />
    </Card>
  );
}

function AddResourceDialog({
  open,
  onOpenChange,
  lesson,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: LessonDetail;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("lessons.addResource")}</DialogTitle>
        </DialogHeader>
        {/* Conditional mount: every open starts from fresh form state. */}
        {open ? (
          <AddResourceForm lesson={lesson} onOpenChange={onOpenChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddResourceForm({
  lesson,
  onOpenChange,
}: {
  lesson: LessonDetail;
  onOpenChange: (open: boolean) => void;
}) {
  const updateLesson = useMutation(api.lessons.updateLesson);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await updateLesson({
        lessonId: lesson._id,
        resources: [
          ...lesson.resources,
          { title: title.trim(), url: url.trim() },
        ],
      });
      toast.success(t("lessons.resourceAdded"));
      onOpenChange(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="resource-title">{t("lessons.resourceTitleLabel")}</Label>
        <Input
          id="resource-title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="resource-url">{t("lessons.resourceUrlLabel")}</Label>
        <Input
          id="resource-url"
          type="url"
          dir="ltr"
          inputMode="url"
          required
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t("common.add")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ——— Notes ———

function NotesCard({ lesson }: { lesson: LessonDetail }) {
  const updateLesson = useMutation(api.lessons.updateLesson);
  const serverNotes = lesson.notes ?? "";
  const [prevServerNotes, setPrevServerNotes] = useState(serverNotes);
  const [notes, setNotes] = useState(serverNotes);
  const [pending, setPending] = useState(false);

  // Re-sync during render when the server value changes (own save echo or
  // another session) instead of holding stale local state in an effect.
  if (prevServerNotes !== serverNotes) {
    setPrevServerNotes(serverNotes);
    setNotes(serverNotes);
  }

  const dirty = notes !== serverNotes;

  async function save() {
    setPending(true);
    try {
      await updateLesson({
        lessonId: lesson._id,
        notes,
        resources: lesson.resources,
      });
      toast.success(t("lessons.notesSaved"));
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("lessons.notesTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("lessons.notesPlaceholder")}
          maxLength={2000}
          className="min-h-28"
          aria-label={t("lessons.notesTitle")}
        />
        <Button
          size="sm"
          className="self-end"
          disabled={!dirty || pending}
          onClick={() => void save()}
        >
          {pending ? <Spinner /> : null}
          {t("lessons.saveNotes")}
        </Button>
      </CardContent>
    </Card>
  );
}
