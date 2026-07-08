"use client";

import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { numberString, useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

/** Row shape returned by api.lessons.listMyClasses. */
type TeachableClass = {
  classId: Id<"classes">;
  className: string;
  gradeName: string;
  subjects: Array<{ subjectId: Id<"subjects">; name: string }>;
};

/** Create a lesson outside the timetable (ad-hoc). */
export function AdhocDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
}) {
  const classes = useQuery(api.lessons.listMyClasses, open ? {} : "skip");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("lessons.adhocDialogTitle")}</DialogTitle>
        </DialogHeader>
        {/* Conditional mount: every open starts from fresh form state. */}
        {open ? (
          <AdhocForm
            classes={classes}
            defaultDate={defaultDate}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AdhocForm({
  classes,
  defaultDate,
  onOpenChange,
}: {
  classes: TeachableClass[] | undefined;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
}) {
  const createAdHoc = useMutation(api.lessons.createAdHoc);

  const form = useAppForm({
    defaultValues: {
      classId: null as string | null,
      subjectId: null as string | null,
      date: defaultDate,
      period: "1",
      title: "",
    },
    validators: {
      onSubmit: z.object({
        classId: z.string().nullable(),
        subjectId: z.string().nullable(),
        date: z.string().min(1, t("common.requiredField")),
        period: numberString({ int: true, min: 1, max: 8 }),
        title: z.string().max(120, t("common.invalidValue")),
      }),
    },
    onSubmit: async ({ value }) => {
      if (!value.classId || !value.subjectId) return;
      try {
        await createAdHoc({
          classId: value.classId as Id<"classes">,
          subjectId: value.subjectId as Id<"subjects">,
          date: value.date,
          period: Number(value.period),
          title: value.title.trim() || undefined,
        });
        toast.success(t("lessons.adhocCreated"));
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
        label: c.className,
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
      <form.AppField name="classId">
        {(field) => (
          <field.SelectField
            label={t("lessons.classLabel")}
            placeholder={t("lessons.choosePlaceholder")}
            items={classItems}
            disabled={classes === undefined}
            onValueChange={(value) => {
              // Single teachable subject: pre-select it, otherwise ask again.
              const cls = (classes ?? []).find((c) => c.classId === value);
              form.setFieldValue(
                "subjectId",
                cls && cls.subjects.length === 1
                  ? (cls.subjects[0].subjectId as string)
                  : null,
              );
            }}
          />
        )}
      </form.AppField>

      {/* Subject options depend on the picked class — resubscribe on change. */}
      <form.Subscribe selector={(s) => s.values.classId}>
        {(classId) => {
          const selectedClass = (classes ?? []).find(
            (c) => c.classId === classId,
          );
          const subjectItems = (selectedClass?.subjects ?? []).map((s) => ({
            value: s.subjectId as string,
            label: s.name,
          }));
          return (
            <form.AppField name="subjectId">
              {(field) => (
                <field.SelectField
                  label={t("lessons.subjectLabel")}
                  placeholder={t("lessons.choosePlaceholder")}
                  items={subjectItems}
                  disabled={selectedClass === undefined}
                />
              )}
            </form.AppField>
          );
        }}
      </form.Subscribe>

      <div className="grid grid-cols-2 gap-3">
        <form.AppField name="date">
          {(field) => (
            <field.TextField
              label={t("lessons.dateLabel")}
              type="date"
              dir="ltr"
            />
          )}
        </form.AppField>
        <form.AppField name="period">
          {(field) => (
            <field.TextField
              label={t("lessons.periodLabel")}
              type="number"
              dir="ltr"
              inputMode="numeric"
              min={1}
              max={8}
              step={1}
            />
          )}
        </form.AppField>
      </div>

      <form.AppField name="title">
        {(field) => (
          <field.TextField label={t("lessons.titleLabel")} maxLength={120} />
        )}
      </form.AppField>

      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <form.AppForm>
          <form.Subscribe
            selector={(s) => !s.values.classId || !s.values.subjectId}
          >
            {(incomplete) => (
              <form.SubmitButton disabled={incomplete}>
                {t("common.add")}
              </form.SubmitButton>
            )}
          </form.Subscribe>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
