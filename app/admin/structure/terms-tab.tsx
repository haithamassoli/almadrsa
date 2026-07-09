"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarRange, CircleCheck, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/components/form";
import { Badge } from "@/components/ui/badge";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, t } from "@/lib/i18n";
import { ConfirmDelete } from "./confirm-delete";
import { structureError } from "./errors";

type Term = {
  _id: Id<"terms">;
  name: string;
  startDate: number;
  endDate: number;
  active: boolean;
};

function msToInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function TermsTab() {
  const terms = useQuery(api.academics.listTerms);
  const createTerm = useMutation(api.academics.createTerm);
  const updateTerm = useMutation(api.academics.updateTerm);
  const deleteTerm = useMutation(api.academics.deleteTerm);
  const setActiveTerm = useMutation(api.academics.setActiveTerm);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Term | null>(null);
  const [activating, setActivating] = useState<Id<"terms"> | null>(null);

  const activeTerm = terms?.find((term) => term.active);

  const form = useAppForm({
    defaultValues: { name: "", start: "", end: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, t("common.requiredField")),
        start: z.string().min(1, t("common.requiredField")),
        end: z.string().min(1, t("common.requiredField")),
      }),
    },
    onSubmit: async ({ value }) => {
      const startDate = Date.parse(value.start);
      const endDate = Date.parse(value.end);
      if (Number.isNaN(startDate) || Number.isNaN(endDate)) return;
      if (endDate <= startDate) {
        toast.error(t("structure.errTermDates"));
        return;
      }
      const name = value.name.trim();
      try {
        if (editing) {
          await updateTerm({ termId: editing._id, name, startDate, endDate });
          toast.success(t("structure.termUpdated"));
        } else {
          await createTerm({ name, startDate, endDate });
          toast.success(t("structure.termCreated"));
        }
        setDialogOpen(false);
      } catch (err) {
        toast.error(structureError(err));
      }
    },
  });

  function openAdd() {
    setEditing(null);
    form.reset({ name: "", start: "", end: "" });
    setDialogOpen(true);
  }

  function openEdit(term: Term) {
    setEditing(term);
    form.reset({
      name: term.name,
      start: msToInput(term.startDate),
      end: msToInput(term.endDate),
    });
    setDialogOpen(true);
  }

  async function onDelete(term: Term) {
    try {
      await deleteTerm({ termId: term._id });
      toast.success(t("structure.termDeleted"));
    } catch (err) {
      toast.error(structureError(err));
    }
  }

  async function onSetActive(term: Term) {
    setActivating(term._id);
    try {
      await setActiveTerm({ termId: term._id });
      toast.success(t("structure.termActivated"));
    } catch (err) {
      toast.error(structureError(err));
    } finally {
      setActivating(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("structure.activeTerm")}:</span>
          {terms === undefined ? (
            <Skeleton className="h-5 w-24" />
          ) : activeTerm ? (
            <Badge>{activeTerm.name}</Badge>
          ) : (
            <Badge variant="outline">—</Badge>
          )}
        </div>
        <Button onClick={openAdd}>
          <Plus className="size-4" aria-hidden />
          {t("structure.addTerm")}
        </Button>
      </div>

      {terms === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : terms.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarRange aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("structure.noTerms")}</EmptyTitle>
            <EmptyDescription>{t("structure.noTermsHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("structure.termName")}</TableHead>
                <TableHead>{t("structure.startDate")}</TableHead>
                <TableHead>{t("structure.endDate")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-40 text-end">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.map((term) => (
                <TableRow key={term._id}>
                  <TableCell className="font-medium">{term.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(term.startDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(term.endDate)}
                  </TableCell>
                  <TableCell>
                    {term.active ? (
                      <Badge>{t("common.active")}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="inline-flex items-center gap-1">
                      {!term.active ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={activating !== null}
                          onClick={() => onSetActive(term)}
                        >
                          {activating === term._id ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <CircleCheck className="size-3.5" aria-hidden />
                          )}
                          {t("structure.setActive")}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("structure.editTerm")}
                        onClick={() => openEdit(term)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <ConfirmDelete
                        title={t("structure.deleteTerm")}
                        description={t("structure.deleteTermConfirm", {
                          name: term.name,
                        })}
                        disabled={term.active}
                        onConfirm={() => onDelete(term)}
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
              {editing ? t("structure.editTerm") : t("structure.addTerm")}
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
                <field.TextField label={t("structure.termName")} />
              )}
            </form.AppField>
            <div className="grid grid-cols-2 gap-3">
              <form.AppField name="start">
                {(field) => (
                  <field.TextField
                    label={t("structure.startDate")}
                    type="date"
                    dir="ltr"
                  />
                )}
              </form.AppField>
              <form.AppField name="end">
                {(field) => (
                  <field.TextField
                    label={t("structure.endDate")}
                    type="date"
                    dir="ltr"
                  />
                )}
              </form.AppField>
            </div>
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
