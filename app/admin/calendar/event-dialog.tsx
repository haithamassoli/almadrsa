"use client";

import { useMemo } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/components/form";
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

const SCHOOL_WIDE = "school";

export type ClassOption = {
  _id: Id<"classes">;
  name: string;
  gradeName: string;
};

/** Admin-only: add a holiday or school event to the calendar. */
export function EventDialog({
  open,
  onOpenChange,
  classes,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: Array<ClassOption> | undefined;
  defaultDate: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("calendarUi.addEvent")}</DialogTitle>
        </DialogHeader>
        {/* Keyed remount: each open starts from fresh initial state. */}
        {open ? (
          <EventForm
            key={defaultDate}
            classes={classes}
            defaultDate={defaultDate}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  classes,
  defaultDate,
  onOpenChange,
}: {
  classes: Array<ClassOption> | undefined;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
}) {
  const createEvent = useMutation(api.events.create);

  const form = useAppForm({
    defaultValues: {
      title: "",
      kind: "event" as "holiday" | "event",
      date: defaultDate,
      endDate: "",
      // Sentinel "school" stands in for school-wide; mapped to undefined at submit.
      scope: SCHOOL_WIDE as string,
    },
    validators: {
      onSubmit: z.object({
        title: z
          .string()
          .trim()
          .min(1, t("common.requiredField"))
          .max(200, t("common.invalidValue")),
        kind: z.enum(["holiday", "event"]),
        date: z.string().min(1, t("common.requiredField")),
        endDate: z.string(),
        scope: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        await createEvent({
          title: value.title,
          kind: value.kind,
          date: value.date,
          endDate: value.endDate || undefined,
          classId:
            value.scope !== SCHOOL_WIDE
              ? (value.scope as Id<"classes">)
              : undefined,
        });
        toast.success(t("calendarUi.eventCreated"));
        onOpenChange(false);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  const kindItems = useMemo(
    () => [
      { value: "event", label: t("calendarUi.kindEvent") },
      { value: "holiday", label: t("calendarUi.kindHoliday") },
    ],
    [],
  );
  const scopeItems = useMemo(
    () => [
      { value: SCHOOL_WIDE, label: t("calendarUi.scopeSchool") },
      ...(classes ?? []).map((c) => ({
        value: c._id as string,
        label: `${c.gradeName} · ${c.name}`,
      })),
    ],
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
      <form.AppField name="title">
        {(field) => (
          <field.TextField
            label={t("calendarUi.eventTitleLabel")}
            maxLength={200}
          />
        )}
      </form.AppField>
      <form.AppField name="kind">
        {(field) => (
          <field.SelectField
            label={t("calendarUi.eventKindLabel")}
            items={kindItems}
          />
        )}
      </form.AppField>
      <div className="grid grid-cols-2 gap-3">
        <form.AppField name="date">
          {(field) => (
            <field.TextField
              label={t("calendarUi.eventDateLabel")}
              type="date"
              dir="ltr"
            />
          )}
        </form.AppField>
        {/* endDate's native min tracks the picked start date. */}
        <form.Subscribe selector={(s) => s.values.date}>
          {(date) => (
            <form.AppField name="endDate">
              {(field) => (
                <field.TextField
                  label={t("calendarUi.eventEndDateLabel")}
                  type="date"
                  dir="ltr"
                  min={date || undefined}
                />
              )}
            </form.AppField>
          )}
        </form.Subscribe>
      </div>
      <form.AppField name="scope">
        {(field) => (
          <field.SelectField
            label={t("calendarUi.eventScopeLabel")}
            items={scopeItems}
          />
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
          <form.SubmitButton>{t("common.save")}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
