"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

export type HomeworkStatus = "open" | "closed";

/** Edit-mode fields — the (class, subject) pairing is fixed at creation. */
export type HomeworkEditTarget = {
  homeworkId: Id<"homework">;
  title: string;
  description?: string;
  deadline: number;
  marks: number;
  className: string;
  subjectName: string;
};

// ——— Shared status badge (list + detail pages import it from here) ———

export function HomeworkStatusBadge({ status }: { status: HomeworkStatus }) {
  return status === "open" ? (
    <Badge
      variant="outline"
      className="border-transparent bg-success/10 text-success"
    >
      {t("homework.statusOpen")}
    </Badge>
  ) : (
    <Badge variant="outline">{t("homework.statusClosed")}</Badge>
  );
}

/** ms → <input type="datetime-local"> value (local wall time, minutes). */
function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Create (homework == null) or edit an OPEN homework. Creation picks a
 * (class, subject) the teacher is assigned to; editing keeps the pairing
 * fixed (server contract) and only touches title/description/deadline/marks.
 */
export function HomeworkDialog({
  open,
  onOpenChange,
  homework,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homework: HomeworkEditTarget | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {homework === null
              ? t("homework.newHomework")
              : t("homework.editHomework")}
          </DialogTitle>
        </DialogHeader>
        {/* Keyed remount: each open (and each different homework) starts
            from fresh initial state instead of re-seeding via an effect. */}
        {open ? (
          <HomeworkForm
            key={homework?.homeworkId ?? "new"}
            homework={homework}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function HomeworkForm({
  homework,
  onOpenChange,
}: {
  homework: HomeworkEditTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const createHomework = useMutation(api.homework.create);
  const updateHomework = useMutation(api.homework.update);
  // Create mode only — edit never re-picks the class/subject.
  const classes = useQuery(
    api.lessons.listMyClasses,
    homework === null ? {} : "skip",
  );

  const [classId, setClassId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState(homework?.title ?? "");
  const [description, setDescription] = useState(homework?.description ?? "");
  const initialDeadlineLocal =
    homework !== null ? msToLocalInput(homework.deadline) : "";
  const [deadlineLocal, setDeadlineLocal] = useState(initialDeadlineLocal);
  const [marks, setMarks] = useState(
    homework !== null ? String(homework.marks) : "10",
  );
  const [pending, setPending] = useState(false);

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );
  const subjectItems = useMemo(() => {
    const cls = (classes ?? []).find((c) => c.classId === classId);
    return (cls?.subjects ?? []).map((s) => ({
      value: s.subjectId as string,
      label: s.name,
    }));
  }, [classes, classId]);

  function onClassChange(value: string | null) {
    setClassId(value);
    const next = (classes ?? []).find((c) => c.classId === value);
    // Same-grade classes share subjects; otherwise the pick no longer applies.
    if (!next?.subjects.some((s) => s.subjectId === subjectId)) {
      setSubjectId(null);
    }
  }

  // Frozen at form mount (the form remounts on every dialog open), so the
  // native min stays "now" without an impure render-time call.
  const [minDeadlineLocal] = useState(() => msToLocalInput(Date.now()));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (homework === null && (classId === null || subjectId === null)) {
      toast.error(t("homework.errMissingClassSubject"));
      return;
    }
    // An unchanged edit-mode deadline is omitted from the payload so the
    // stored ms (with seconds) is kept and never re-validated server-side.
    const deadlineChanged = deadlineLocal !== initialDeadlineLocal;
    const deadlineMs = new Date(deadlineLocal).getTime();
    if (
      deadlineChanged &&
      (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now())
    ) {
      toast.error(t("homework.errDeadlinePast"));
      return;
    }
    setPending(true);
    try {
      if (homework === null) {
        await createHomework({
          classId: classId as Id<"classes">,
          subjectId: subjectId as Id<"subjects">,
          title: title.trim(),
          description: description.trim() || undefined,
          deadline: deadlineMs,
          marks: Number(marks),
        });
        toast.success(t("homework.created"));
      } else {
        await updateHomework({
          homeworkId: homework.homeworkId,
          title: title.trim(),
          // Always sent: whitespace-only clears the stored description.
          description,
          deadline: deadlineChanged ? deadlineMs : undefined,
          marks: Number(marks),
        });
        toast.success(t("homework.updated"));
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {homework === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label id="homework-class-label">{t("homework.fieldClass")}</Label>
            <Select
              items={classItems}
              value={classId}
              onValueChange={(value) =>
                onClassChange((value as string | null) ?? null)
              }
              disabled={classes === undefined}
            >
              <SelectTrigger
                className="w-full"
                aria-labelledby="homework-class-label"
              >
                <SelectValue placeholder={t("homework.selectClass")} />
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
          <div className="flex flex-col gap-2">
            <Label id="homework-subject-label">
              {t("homework.fieldSubject")}
            </Label>
            <Select
              items={subjectItems}
              value={subjectId}
              onValueChange={(value) =>
                setSubjectId((value as string | null) ?? null)
              }
              disabled={classId === null}
            >
              <SelectTrigger
                className="w-full"
                aria-labelledby="homework-subject-label"
              >
                <SelectValue placeholder={t("homework.selectSubject")} />
              </SelectTrigger>
              <SelectContent>
                {subjectItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {homework.className} · {homework.subjectName}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="homework-title">{t("homework.fieldTitle")}</Label>
        <Input
          id="homework-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="homework-description">
          {t("homework.fieldDescription")}
        </Label>
        <Textarea
          id="homework-description"
          rows={3}
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="homework-deadline">
            {t("homework.fieldDeadline")}
          </Label>
          <Input
            id="homework-deadline"
            type="datetime-local"
            dir="ltr"
            required
            min={minDeadlineLocal}
            value={deadlineLocal}
            onChange={(e) => setDeadlineLocal(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="homework-marks">{t("homework.fieldMarks")}</Label>
          <Input
            id="homework-marks"
            type="number"
            dir="ltr"
            inputMode="numeric"
            required
            min={1}
            max={100}
            step={1}
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
          />
        </div>
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
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
