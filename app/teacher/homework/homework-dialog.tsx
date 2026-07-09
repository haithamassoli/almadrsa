"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { numberString, useAppForm } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { msToLocalInput, t } from "@/lib/i18n";
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

  const initialDeadlineLocal =
    homework !== null ? msToLocalInput(homework.deadline) : "";

  // Frozen at form mount (the form remounts on every dialog open), so the
  // native min stays "now" without an impure render-time call.
  const [minDeadlineLocal] = useState(() => msToLocalInput(Date.now()));

  const form = useAppForm({
    defaultValues: {
      classId: null as string | null,
      subjectId: null as string | null,
      title: homework?.title ?? "",
      description: homework?.description ?? "",
      deadlineLocal: initialDeadlineLocal,
      marks: homework !== null ? String(homework.marks) : "10",
    },
    validators: {
      onSubmit: z
        .object({
          classId: z.string().nullable(),
          subjectId: z.string().nullable(),
          title: z
            .string()
            .trim()
            .min(1, t("common.requiredField"))
            .max(200, t("common.invalidValue")),
          description: z.string().max(4000, t("common.invalidValue")),
          deadlineLocal: z.string().min(1, t("common.requiredField")),
          marks: numberString({ int: true, min: 1, max: 100 }),
        })
        // Create mode needs a (class, subject); edit keeps the pairing fixed.
        .refine((v) => homework !== null || (!!v.classId && !!v.subjectId), {
          message: t("homework.errMissingClassSubject"),
          path: ["subjectId"],
        }),
    },
    onSubmit: async ({ value }) => {
      // An unchanged edit-mode deadline is omitted from the payload so the
      // stored ms (with seconds) is kept and never re-validated server-side.
      const deadlineChanged = value.deadlineLocal !== initialDeadlineLocal;
      const deadlineMs = new Date(value.deadlineLocal).getTime();
      const mustCheckDeadline = homework === null || deadlineChanged;
      if (
        mustCheckDeadline &&
        (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now())
      ) {
        toast.error(t("homework.errDeadlinePast"));
        return;
      }
      try {
        if (homework === null) {
          await createHomework({
            classId: value.classId as Id<"classes">,
            subjectId: value.subjectId as Id<"subjects">,
            title: value.title.trim(),
            description: value.description.trim() || undefined,
            deadline: deadlineMs,
            marks: Number(value.marks),
          });
          toast.success(t("homework.created"));
        } else {
          await updateHomework({
            homeworkId: homework.homeworkId,
            title: value.title.trim(),
            // Always sent: whitespace-only clears the stored description.
            description: value.description,
            deadline: deadlineChanged ? deadlineMs : undefined,
            marks: Number(value.marks),
          });
          toast.success(t("homework.updated"));
        }
        onOpenChange(false);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {homework === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.AppField name="classId">
            {(field) => (
              <field.SelectField
                label={t("homework.fieldClass")}
                placeholder={t("homework.selectClass")}
                items={classItems}
                disabled={classes === undefined}
                onValueChange={(value) => {
                  // Same-grade classes share subjects; otherwise the picked
                  // subject no longer applies and is cleared.
                  const next = (classes ?? []).find((c) => c.classId === value);
                  if (
                    !next?.subjects.some(
                      (s) => s.subjectId === form.state.values.subjectId,
                    )
                  ) {
                    form.setFieldValue("subjectId", null);
                  }
                }}
              />
            )}
          </form.AppField>
          {/* Subject options depend on the picked class — resubscribe on change. */}
          <form.Subscribe selector={(s) => s.values.classId}>
            {(classId) => {
              const cls = (classes ?? []).find((c) => c.classId === classId);
              const subjectItems = (cls?.subjects ?? []).map((s) => ({
                value: s.subjectId as string,
                label: s.name,
              }));
              return (
                <form.AppField name="subjectId">
                  {(field) => (
                    <field.SelectField
                      label={t("homework.fieldSubject")}
                      placeholder={t("homework.selectSubject")}
                      items={subjectItems}
                      disabled={classId === null}
                    />
                  )}
                </form.AppField>
              );
            }}
          </form.Subscribe>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {homework.className} · {homework.subjectName}
        </p>
      )}

      <form.AppField name="title">
        {(field) => (
          <field.TextField label={t("homework.fieldTitle")} maxLength={200} />
        )}
      </form.AppField>

      <form.AppField name="description">
        {(field) => (
          <field.TextareaField
            label={t("homework.fieldDescription")}
            rows={3}
            maxLength={4000}
          />
        )}
      </form.AppField>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <form.AppField name="deadlineLocal">
          {(field) => (
            <field.TextField
              label={t("homework.fieldDeadline")}
              type="datetime-local"
              dir="ltr"
              min={minDeadlineLocal}
            />
          )}
        </form.AppField>
        <form.AppField name="marks">
          {(field) => (
            <field.TextField
              label={t("homework.fieldMarks")}
              type="number"
              dir="ltr"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
            />
          )}
        </form.AppField>
      </div>

      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t("common.save")}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
