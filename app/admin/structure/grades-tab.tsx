"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Layers, Pencil, Plus } from "lucide-react";
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

type Grade = { _id: Id<"grades">; name: string; order: number };

export function GradesTab() {
  const grades = useQuery(api.academics.listGrades);
  const createGrade = useMutation(api.academics.createGrade);
  const updateGrade = useMutation(api.academics.updateGrade);
  const deleteGrade = useMutation(api.academics.deleteGrade);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Grade | null>(null);
  const [name, setName] = useState("");
  const [order, setOrder] = useState("1");
  const [pending, setPending] = useState(false);

  function openAdd() {
    setEditing(null);
    setName("");
    const nextOrder =
      grades && grades.length > 0
        ? Math.max(...grades.map((g) => g.order)) + 1
        : 1;
    setOrder(String(nextOrder));
    setDialogOpen(true);
  }

  function openEdit(grade: Grade) {
    setEditing(grade);
    setName(grade.name);
    setOrder(String(grade.order));
    setDialogOpen(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const orderNum = Number(order);
    if (!name.trim() || !Number.isFinite(orderNum)) return;
    setPending(true);
    try {
      if (editing) {
        await updateGrade({ gradeId: editing._id, name, order: orderNum });
        toast.success(t("structure.gradeUpdated"));
      } else {
        await createGrade({ name, order: orderNum });
        toast.success(t("structure.gradeCreated"));
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(structureError(err));
    } finally {
      setPending(false);
    }
  }

  async function onDelete(grade: Grade) {
    try {
      await deleteGrade({ gradeId: grade._id });
      toast.success(t("structure.gradeDeleted"));
    } catch (err) {
      toast.error(structureError(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t("structure.tabGrades")}
        </span>
        <Button onClick={openAdd}>
          <Plus className="size-4" aria-hidden />
          {t("structure.addGrade")}
        </Button>
      </div>

      {grades === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : grades.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Layers aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("structure.noGrades")}</EmptyTitle>
            <EmptyDescription>{t("structure.noGradesHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">
                  {t("structure.gradeOrder")}
                </TableHead>
                <TableHead>{t("structure.gradeName")}</TableHead>
                <TableHead className="w-24 text-end">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grades.map((grade) => (
                <TableRow key={grade._id}>
                  <TableCell className="text-muted-foreground">
                    {grade.order}
                  </TableCell>
                  <TableCell className="font-medium">{grade.name}</TableCell>
                  <TableCell className="text-end">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("structure.editGrade")}
                        onClick={() => openEdit(grade)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <ConfirmDelete
                        title={t("structure.deleteGrade")}
                        description={t("structure.deleteGradeConfirm", {
                          name: grade.name,
                        })}
                        onConfirm={() => onDelete(grade)}
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
              {editing ? t("structure.editGrade") : t("structure.addGrade")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="grade-name">{t("structure.gradeName")}</Label>
              <Input
                id="grade-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="grade-order">{t("structure.gradeOrder")}</Label>
              <Input
                id="grade-order"
                type="number"
                dir="ltr"
                required
                inputMode="numeric"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
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
