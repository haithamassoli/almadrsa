"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
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

  const [subjectId, setSubjectId] = useState<string>(slot?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState<string>(slot?.teacherId ?? "");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const subjectItems = useMemo(
    () => subjects.map((s) => ({ value: s.subjectId as string, label: s.name })),
    [subjects],
  );
  const teacherItems = useMemo(
    () => teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })),
    [teachers],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!subjectId || !teacherId) return;
    setPending(true);
    try {
      await upsertSlot({
        classId,
        weekday,
        period,
        subjectId: subjectId as Id<"subjects">,
        teacherId,
      });
      toast.success(t("timetable.saved"));
      onOpenChange(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!slot) return;
    setPending(true);
    try {
      await deleteSlot({ slotId: slot._id });
      toast.success(t("timetable.deleted"));
      setConfirmDelete(false);
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
        <Label id="slot-subject-label">{t("timetable.subject")}</Label>
        <Select
          items={subjectItems}
          value={subjectId}
          onValueChange={(value) => setSubjectId(value as string)}
        >
          <SelectTrigger
            aria-labelledby="slot-subject-label"
            className="w-full"
          >
            <SelectValue placeholder={t("timetable.selectSubject")} />
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
      <div className="flex flex-col gap-2">
        <Label id="slot-teacher-label">{t("timetable.teacher")}</Label>
        <Select
          items={teacherItems}
          value={teacherId}
          onValueChange={(value) => setTeacherId(value as string)}
        >
          <SelectTrigger
            aria-labelledby="slot-teacher-label"
            className="w-full"
          >
            <SelectValue placeholder={t("timetable.selectTeacher")} />
          </SelectTrigger>
          <SelectContent>
            {teacherItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DialogFooter className="mt-2 sm:justify-between">
        {slot !== null ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
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
          <Button type="submit" disabled={pending || !subjectId || !teacherId}>
            {pending ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        </div>
      </DialogFooter>

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
              disabled={pending}
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
