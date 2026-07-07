"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus, School } from "lucide-react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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

type ClassRow = { _id: Id<"classes">; name: string };

export function ClassesTab() {
  const grades = useQuery(api.academics.listGrades);
  const [pickedGradeId, setGradeId] = useState<Id<"grades"> | null>(null);
  // Default to the first grade once loaded; derived, not synced via effect.
  const gradeId = pickedGradeId ?? grades?.[0]?._id ?? null;

  const classes = useQuery(
    api.academics.listClassesByGrade,
    gradeId ? { gradeId } : "skip",
  );
  const createClass = useMutation(api.academics.createClass);
  const updateClass = useMutation(api.academics.updateClass);
  const deleteClass = useMutation(api.academics.deleteClass);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  function openAdd() {
    setEditing(null);
    setName("");
    setDialogOpen(true);
  }

  function openEdit(cls: ClassRow) {
    setEditing(cls);
    setName(cls.name);
    setDialogOpen(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !gradeId) return;
    setPending(true);
    try {
      if (editing) {
        await updateClass({ classId: editing._id, name });
        toast.success(t("structure.classUpdated"));
      } else {
        await createClass({ name, gradeId });
        toast.success(t("structure.classCreated"));
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(structureError(err));
    } finally {
      setPending(false);
    }
  }

  async function onDelete(cls: ClassRow) {
    try {
      await deleteClass({ classId: cls._id });
      toast.success(t("structure.classDeleted"));
    } catch (err) {
      toast.error(structureError(err));
    }
  }

  if (grades !== undefined && grades.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <School aria-hidden />
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
          {t("structure.addClass")}
        </Button>
      </div>

      {!gradeId || classes === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : classes.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <School aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("structure.noClasses")}</EmptyTitle>
            <EmptyDescription>{t("structure.noClassesHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("structure.className")}</TableHead>
                <TableHead className="w-24 text-end">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((cls) => (
                <TableRow key={cls._id}>
                  <TableCell className="font-medium">{cls.name}</TableCell>
                  <TableCell className="text-end">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("structure.editClass")}
                        onClick={() => openEdit(cls)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <ConfirmDelete
                        title={t("structure.deleteClass")}
                        description={t("structure.deleteClassConfirm", {
                          name: cls.name,
                        })}
                        onConfirm={() => onDelete(cls)}
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
              {editing ? t("structure.editClass") : t("structure.addClass")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="class-name">{t("structure.className")}</Label>
              <Input
                id="class-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
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
    </div>
  );
}
