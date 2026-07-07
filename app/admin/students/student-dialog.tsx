"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
  const createStudent = useMutation(api.students.createStudent);
  const updateStudent = useMutation(api.students.updateStudent);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [classValue, setClassValue] = useState<string>(NO_CLASS);
  const [pending, setPending] = useState(false);

  // Re-seed the form each time the dialog opens (for a different student or
  // a fresh create).
  useEffect(() => {
    if (!open) return;
    setFirstName(student?.firstName ?? "");
    setLastName(student?.lastName ?? "");
    setGuardianName(student?.guardianName ?? "");
    setGuardianPhone(student?.guardianPhone ?? "");
    setClassValue(student?.classId ?? NO_CLASS);
    setPending(false);
  }, [open, student]);

  const classItems = useMemo(
    () => [
      { value: NO_CLASS, label: t("students.noClass") },
      ...(classes ?? []).map((c) => ({ value: c._id as string, label: c.name })),
    ],
    [classes],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const classId =
      classValue !== NO_CLASS ? (classValue as Id<"classes">) : undefined;
    try {
      if (student === null) {
        await createStudent({
          firstName,
          lastName,
          guardianName: guardianName.trim() || undefined,
          guardianPhone: guardianPhone.trim() || undefined,
          classId,
        });
        toast.success(t("students.created"));
      } else {
        await updateStudent({
          studentId: student._id,
          firstName,
          lastName,
          // Always sent: empty string clears the field server-side.
          guardianName,
          guardianPhone,
          classId,
        });
        toast.success(t("students.updated"));
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

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
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="student-first-name">
                {t("students.firstName")}
              </Label>
              <Input
                id="student-first-name"
                required
                maxLength={100}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="student-last-name">
                {t("students.lastName")}
              </Label>
              <Input
                id="student-last-name"
                required
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="student-guardian-name">
              {t("students.guardianName")}
            </Label>
            <Input
              id="student-guardian-name"
              maxLength={100}
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="student-guardian-phone">
              {t("students.guardianPhone")}
            </Label>
            <Input
              id="student-guardian-phone"
              dir="ltr"
              inputMode="tel"
              maxLength={20}
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label id="student-class-label">{t("students.class")}</Label>
            <Select
              items={classItems}
              value={classValue}
              onValueChange={(value) => setClassValue(value as string)}
            >
              <SelectTrigger
                aria-labelledby="student-class-label"
                className="w-full"
              >
                <SelectValue />
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
      </DialogContent>
    </Dialog>
  );
}
