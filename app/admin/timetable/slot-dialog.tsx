"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";
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

export type SlotSubject = { subjectId: Id<"subjects">; name: string };
export type SlotTeacher = { id: string; name: string };
export type ExistingSlot = {
  _id: Id<"timetableSlots">;
  subjectId: Id<"subjects">;
  teacherId: string;
};

/** Create (slot == null) or edit a single timetable slot. */
export function SlotDialog({
  open,
  onOpenChange,
  classId,
  weekday,
  period,
  slot,
  subjects,
  teachers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: Id<"classes">;
  weekday: number;
  period: number;
  slot: ExistingSlot | null;
  subjects: SlotSubject[];
  teachers: SlotTeacher[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {slot === null ? t("timetable.addSlot") : t("timetable.editSlot")}
          </DialogTitle>
        </DialogHeader>
        {/* Keyed remount: each cell (and create vs edit) starts fresh. */}
        {open ? (
          <SlotForm
            key={slot?._id ?? "new"}
            classId={classId}
            weekday={weekday}
            period={period}
            slot={slot}
            subjects={subjects}
            teachers={teachers}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SlotForm({
  classId,
  weekday,
  period,
  slot,
  subjects,
  teachers,
  onOpenChange,
}: {
  classId: Id<"classes">;
  weekday: number;
  period: number;
  slot: ExistingSlot | null;
  subjects: SlotSubject[];
  teachers: SlotTeacher[];
  onOpenChange: (open: boolean) => void;
}) {
  const upsertSlot = useMutation(api.timetable.upsertSlot);
  const deleteSlot = useMutation(api.timetable.deleteSlot);

  // Delete runs outside the form's submit flow, so it keeps its own pending flag.
  const [deletePending, setDeletePending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useAppForm({
    defaultValues: {
      subjectId: (slot?.subjectId ?? null) as string | null,
      teacherId: (slot?.teacherId ?? null) as string | null,
    },
    validators: {
      onSubmit: z.object({
        subjectId: z.string().nullable(),
        teacherId: z.string().nullable(),
      }),
    },
    onSubmit: async ({ value }) => {
      // Guard mirrors the disabled Save button; also narrows the nullable fields.
      if (!value.subjectId || !value.teacherId) return;
      try {
        await upsertSlot({
          classId,
          weekday,
          period,
          subjectId: value.subjectId as Id<"subjects">,
          teacherId: value.teacherId,
        });
        toast.success(t("timetable.saved"));
        onOpenChange(false);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  const subjectItems = useMemo(
    () => subjects.map((s) => ({ value: s.subjectId as string, label: s.name })),
    [subjects],
  );
  const teacherItems = useMemo(
    () => teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })),
    [teachers],
  );

  async function onDelete() {
    if (!slot) return;
    setDeletePending(true);
    try {
      await deleteSlot({ slotId: slot._id });
      toast.success(t("timetable.deleted"));
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <form.AppField name="subjectId">
        {(field) => (
          <field.SelectField
            label={t("timetable.subject")}
            placeholder={t("timetable.selectSubject")}
            items={subjectItems}
          />
        )}
      </form.AppField>
      <form.AppField name="teacherId">
        {(field) => (
          <field.SelectField
            label={t("timetable.teacher")}
            placeholder={t("timetable.selectTeacher")}
            items={teacherItems}
          />
        )}
      </form.AppField>

      <form.Subscribe
        selector={(s) => ({
          subjectId: s.values.subjectId,
          teacherId: s.values.teacherId,
          isSubmitting: s.isSubmitting,
        })}
      >
        {({ subjectId, teacherId, isSubmitting }) => (
          <DialogFooter className="mt-2 sm:justify-between">
            {slot !== null ? (
              <Button
                type="button"
                variant="destructive"
                disabled={deletePending || isSubmitting}
                onClick={() => setConfirmDelete(true)}
              >
                {t("timetable.deleteSlot")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <form.AppForm>
                <form.SubmitButton
                  disabled={deletePending || !subjectId || !teacherId}
                >
                  {t("common.save")}
                </form.SubmitButton>
              </form.AppForm>
            </div>
          </DialogFooter>
        )}
      </form.Subscribe>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("timetable.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("timetable.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletePending}
              onClick={onDelete}
            >
              {t("timetable.deleteSlot")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
