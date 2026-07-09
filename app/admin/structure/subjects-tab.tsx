"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { BookOpen, Pencil, Plus } from "lucide-react";
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
import { GradeSelect } from "./grade-select";

type Subject = { _id: Id<"subjects">; name: string };

export function SubjectsTab() {
  const grades = useQuery(api.academics.listGrades);
  const [pickedGradeId, setGradeId] = useState<Id<"grades"> | null>(null);
  // Default to the first grade once loaded; derived, not synced via effect.
  const gradeId = pickedGradeId ?? grades?.[0]?._id ?? null;

  const subjects = useQuery(
    api.academics.listSubjectsByGrade,
    gradeId ? { gradeId } : "skip",
  );
  const createSubject = useMutation(api.academics.createSubject);
  const updateSubject = useMutation(api.academics.updateSubject);
  const deleteSubject = useMutation(api.academics.deleteSubject);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);

  const form = useAppForm({
    defaultValues: { name: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, t("common.requiredField")),
      }),
    },
    onSubmit: async ({ value }) => {
      const name = value.name.trim();
      try {
        if (editing) {
          await updateSubject({ subjectId: editing._id, name });
          toast.success(t("structure.subjectUpdated"));
        } else {
          if (!gradeId) return;
          await createSubject({ name, gradeId });
          toast.success(t("structure.subjectCreated"));
        }
        setDialogOpen(false);
      } catch (err) {
        toast.error(structureError(err));
      }
    },
  });

  function openAdd() {
    setEditing(null);
    form.reset({ name: "" });
    setDialogOpen(true);
  }

  function openEdit(subject: Subject) {
    setEditing(subject);
    form.reset({ name: subject.name });
    setDialogOpen(true);
  }

  async function onDelete(subject: Subject) {
    try {
      await deleteSubject({ subjectId: subject._id });
      toast.success(t("structure.subjectDeleted"));
    } catch (err) {
      toast.error(structureError(err));
    }
  }

  if (grades !== undefined && grades.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t("structure.noGrades")}</EmptyTitle>
          <EmptyDescription>{t("structure.noGradesYet")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GradeSelect grades={grades} value={gradeId} onChange={setGradeId} />
        <Button onClick={openAdd} disabled={!gradeId}>
          <Plus className="size-4" aria-hidden />
          {t("structure.addSubject")}
        </Button>
      </div>

      {!gradeId || subjects === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : subjects.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("structure.noSubjects")}</EmptyTitle>
            <EmptyDescription>
              {t("structure.noSubjectsHint")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("structure.subjectName")}</TableHead>
                <TableHead className="w-24 text-end">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((subject) => (
                <TableRow key={subject._id}>
                  <TableCell className="font-medium">{subject.name}</TableCell>
                  <TableCell className="text-end">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("structure.editSubject")}
                        onClick={() => openEdit(subject)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <ConfirmDelete
                        title={t("structure.deleteSubject")}
                        description={t("structure.deleteSubjectConfirm", {
                          name: subject.name,
                        })}
                        onConfirm={() => onDelete(subject)}
                      />
                    </div>
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
            <DialogTitle>
              {editing
                ? t("structure.editSubject")
                : t("structure.addSubject")}
            </DialogTitle>
          </DialogHeader>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <form.AppField name="name">
              {(field) => (
                <field.TextField label={t("structure.subjectName")} />
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
                <form.SubmitButton>{t("common.save")}</form.SubmitButton>
              </form.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
