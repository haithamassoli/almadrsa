"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, UserCheck } from "lucide-react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n";
import { ConfirmDelete } from "./confirm-delete";
import { structureError } from "./errors";

export function AssignmentsTab() {
  const classes = useQuery(api.academics.listAllClasses, {});
  const staff = useQuery(api.staff.listStaff);
  const teachers = staff?.filter((s) => s.role === "teacher" && !s.banned);

  const [pickedClassId, setClassId] = useState<Id<"classes"> | null>(null);
  // Default to the first class once loaded; derived, not synced via effect.
  const classId = pickedClassId ?? classes?.[0]?._id ?? null;
  const selectedClass = classes?.find((c) => c._id === classId);

  const assignments = useQuery(
    api.academics.listAssignments,
    classId ? { classId } : "skip",
  );
  const subjects = useQuery(
    api.academics.listSubjectsByGrade,
    selectedClass ? { gradeId: selectedClass.gradeId } : "skip",
  );
  const createAssignment = useMutation(api.academics.createAssignment);
  const deleteAssignment = useMutation(api.academics.deleteAssignment);

  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useAppForm({
    defaultValues: {
      teacherId: null as string | null,
      subjectId: null as string | null,
    },
    validators: {
      onSubmit: z.object({
        teacherId: z.string().nullable(),
        subjectId: z.string().nullable(),
      }),
    },
    onSubmit: async ({ value }) => {
      if (!classId || !value.teacherId || !value.subjectId) return;
      try {
        await createAssignment({
          teacherId: value.teacherId,
          subjectId: value.subjectId as Id<"subjects">,
          classId,
        });
        toast.success(t("structure.assignmentCreated"));
        setDialogOpen(false);
      } catch (err) {
        toast.error(structureError(err));
      }
    },
  });

  function openAdd() {
    form.reset({ teacherId: null, subjectId: null });
    setDialogOpen(true);
  }

  async function onDelete(assignmentId: Id<"teacherAssignments">) {
    try {
      await deleteAssignment({ assignmentId });
      toast.success(t("structure.assignmentDeleted"));
    } catch (err) {
      toast.error(structureError(err));
    }
  }

  if (classes !== undefined && classes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserCheck aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t("structure.noClasses")}</EmptyTitle>
          <EmptyDescription>{t("structure.noClassesYet")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {classes === undefined ? (
          <Skeleton className="h-8 w-56" />
        ) : (
          <Select
            items={classes.map((c) => ({ label: c.name, value: c._id }))}
            value={classId}
            onValueChange={(next) => {
              if (next) setClassId(next as Id<"classes">);
            }}
          >
            <SelectTrigger
              className="w-56"
              aria-label={t("structure.selectClass")}
            >
              <SelectValue placeholder={t("structure.selectClass")} />
            </SelectTrigger>
            <SelectContent>
              {classes.map((cls) => (
                <SelectItem key={cls._id} value={cls._id}>
                  {cls.name}
                  <span className="text-xs text-muted-foreground">
                    {cls.gradeName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button onClick={openAdd} disabled={!classId}>
          <Plus className="size-4" aria-hidden />
          {t("structure.addAssignment")}
        </Button>
      </div>

      {!classId || assignments === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : assignments.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserCheck aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("structure.noAssignments")}</EmptyTitle>
            <EmptyDescription>
              {t("structure.noAssignmentsHint")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("structure.teacher")}</TableHead>
                <TableHead>{t("structure.subject")}</TableHead>
                <TableHead className="w-16 text-end">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow key={assignment._id}>
                  <TableCell className="font-medium">
                    {assignment.teacherName}
                  </TableCell>
                  <TableCell>{assignment.subjectName}</TableCell>
                  <TableCell className="text-end">
                    <ConfirmDelete
                      title={t("structure.deleteAssignment")}
                      description={t("structure.deleteAssignmentConfirm", {
                        teacher: assignment.teacherName,
                        subject: assignment.subjectName,
                      })}
                      onConfirm={() => onDelete(assignment._id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("structure.addAssignment")}</DialogTitle>
          </DialogHeader>
          {teachers !== undefined && teachers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("structure.noTeachers")}
            </p>
          ) : subjects !== undefined && subjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("structure.noSubjectsForClass")}
            </p>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
              className="flex flex-col gap-4"
            >
              {/* Teacher label differs between trigger (name) and dropdown
                  (name + email), which the shared SelectField can't express,
                  so this stays a raw Select bound to the field. */}
              <form.AppField name="teacherId">
                {(field) => (
                  <div className="flex flex-col gap-2">
                    <Label id="assignment-teacher-label">
                      {t("structure.teacher")}
                    </Label>
                    <Select
                      items={(teachers ?? []).map((teacher) => ({
                        label: teacher.name,
                        value: teacher.id,
                      }))}
                      value={field.state.value}
                      onValueChange={(next) =>
                        field.handleChange((next as string | null) ?? null)
                      }
                      onOpenChange={(open) => {
                        if (!open) field.handleBlur();
                      }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label={t("structure.selectTeacher")}
                      >
                        <SelectValue
                          placeholder={t("structure.selectTeacher")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(teachers ?? []).map((teacher) => (
                          <SelectItem key={teacher.id} value={teacher.id}>
                            {teacher.name}
                            <span
                              className="text-xs text-muted-foreground"
                              dir="ltr"
                            >
                              {teacher.email}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.AppField>
              <form.AppField name="subjectId">
                {(field) => (
                  <field.SelectField
                    label={t("structure.subject")}
                    placeholder={t("structure.selectSubject")}
                    aria-label={t("structure.selectSubject")}
                    items={(subjects ?? []).map((subject) => ({
                      value: subject._id,
                      label: subject.name,
                    }))}
                  />
                )}
              </form.AppField>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <form.AppForm>
                  <form.Subscribe
                    selector={(s) => !s.values.teacherId || !s.values.subjectId}
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
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
