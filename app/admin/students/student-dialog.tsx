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
import type { ClassOption, StudentRow } from "./types";

const NO_CLASS = "none";

/** Create (student == null) or edit a student. */
export function StudentDialog({
  open,
  onOpenChange,
  student,
  classes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: StudentRow | null;
  classes: ClassOption[] | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {student === null
              ? t("students.addStudent")
              : t("students.editStudent")}
          </DialogTitle>
        </DialogHeader>
        {/* Keyed remount replaces re-seeding form state via an effect: each
            open (and each different student) starts from fresh initial state. */}
        {open ? (
          <StudentForm
            key={student?._id ?? "new"}
            student={student}
            classes={classes}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StudentForm({
  student,
  classes,
  onOpenChange,
}: {
  student: StudentRow | null;
  classes: ClassOption[] | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const createStudent = useMutation(api.students.createStudent);
  const updateStudent = useMutation(api.students.updateStudent);

  const form = useAppForm({
    defaultValues: {
      firstName: student?.firstName ?? "",
      lastName: student?.lastName ?? "",
      guardianName: student?.guardianName ?? "",
      guardianPhone: student?.guardianPhone ?? "",
      // Sentinel "none" stands in for "no class"; mapped back to undefined at submit.
      classId: (student?.classId ?? NO_CLASS) as string,
    },
    validators: {
      onSubmit: z.object({
        firstName: z
          .string()
          .trim()
          .min(1, t("common.requiredField"))
          .max(100, t("common.invalidValue")),
        lastName: z
          .string()
          .trim()
          .min(1, t("common.requiredField"))
          .max(100, t("common.invalidValue")),
        guardianName: z.string().max(100, t("common.invalidValue")),
        guardianPhone: z.string().max(20, t("common.invalidValue")),
        classId: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      const classId =
        value.classId !== NO_CLASS
          ? (value.classId as Id<"classes">)
          : undefined;
      try {
        if (student === null) {
          await createStudent({
            firstName: value.firstName,
            lastName: value.lastName,
            guardianName: value.guardianName.trim() || undefined,
            guardianPhone: value.guardianPhone.trim() || undefined,
            classId,
          });
          toast.success(t("students.created"));
        } else {
          await updateStudent({
            studentId: student._id,
            firstName: value.firstName,
            lastName: value.lastName,
            // Always sent: empty string clears the field server-side.
            guardianName: value.guardianName,
            guardianPhone: value.guardianPhone,
            classId,
          });
          toast.success(t("students.updated"));
        }
        onOpenChange(false);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  const classItems = useMemo(
    () => [
      { value: NO_CLASS, label: t("students.noClass") },
      ...(classes ?? []).map((c) => ({ value: c._id as string, label: c.name })),
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
      <div className="grid grid-cols-2 gap-3">
        <form.AppField name="firstName">
          {(field) => (
            <field.TextField label={t("students.firstName")} maxLength={100} />
          )}
        </form.AppField>
        <form.AppField name="lastName">
          {(field) => (
            <field.TextField label={t("students.lastName")} maxLength={100} />
          )}
        </form.AppField>
      </div>
      <form.AppField name="guardianName">
        {(field) => (
          <field.TextField label={t("students.guardianName")} maxLength={100} />
        )}
      </form.AppField>
      <form.AppField name="guardianPhone">
        {(field) => (
          <field.TextField
            label={t("students.guardianPhone")}
            dir="ltr"
            inputMode="tel"
            maxLength={20}
          />
        )}
      </form.AppField>
      <form.AppField name="classId">
        {(field) => (
          <field.SelectField label={t("students.class")} items={classItems} />
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
