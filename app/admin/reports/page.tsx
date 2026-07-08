"use client";

import { Component, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { EllipsisVertical, Eye, NotebookPen, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/components/form";
import { ReportCardView } from "@/components/report-card-view";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

type ReportRow = FunctionReturnType<typeof api.reports.listForClass>[number];
type CardTarget = { cardId: Id<"reportCards">; studentName: string };

/** getCard can race a concurrent delete — degrade to a quiet error line. */
class QueryBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("common.errorGeneric")}
      </p>
    ) : (
      this.props.children
    );
  }
}

function StatusBadge({ status }: { status: ReportRow["status"] }) {
  if (status === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (status === "draft") {
    return <Badge variant="secondary">{t("reports.statusDraft")}</Badge>;
  }
  return (
    <Badge
      variant="outline"
      className="border-transparent bg-success/10 text-success"
    >
      {t("reports.statusPublished")}
    </Badge>
  );
}

/** Preview dialog body — its own component so the boundary catches useQuery. */
function PreviewBody({ cardId }: { cardId: Id<"reportCards"> }) {
  const card = useQuery(api.reports.getCard, { cardId });
  if (card === undefined) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }
  return <ReportCardView card={card} />;
}

/** Remarks editor — prefills from getCard, saves through updateRemarks. */
function RemarksForm({
  target,
  onClose,
}: {
  target: CardTarget;
  onClose: () => void;
}) {
  const card = useQuery(api.reports.getCard, { cardId: target.cardId });

  if (card === undefined) {
    return <Skeleton className="h-28 w-full rounded-xl" />;
  }

  // Mounted only once the card resolves, so the form seeds from the loaded
  // remarks at mount (no reset effect) and remounts per card via the parent key.
  return (
    <RemarksEditor
      cardId={target.cardId}
      initialRemarks={card.remarks ?? ""}
      onClose={onClose}
    />
  );
}

function RemarksEditor({
  cardId,
  initialRemarks,
  onClose,
}: {
  cardId: Id<"reportCards">;
  initialRemarks: string;
  onClose: () => void;
}) {
  const updateRemarks = useMutation(api.reports.updateRemarks);

  const form = useAppForm({
    defaultValues: { remarks: initialRemarks },
    validators: {
      // Remarks are optional — the native maxLength caps input at 2000.
      onSubmit: z.object({ remarks: z.string() }),
    },
    onSubmit: async ({ value }) => {
      try {
        // Sent verbatim: whitespace-only clears the stored remarks.
        await updateRemarks({ cardId, remarks: value.remarks });
        toast.success(t("reports.remarksSaved"));
        onClose();
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <form.AppField name="remarks">
        {(field) => (
          <field.TextareaField
            placeholder={t("reports.remarksPlaceholder")}
            maxLength={2000}
            rows={5}
            autoFocus
          />
        )}
      </form.AppField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t("common.save")}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}

export default function AdminReportsPage() {
  const terms = useQuery(api.academics.listTerms, {});
  const classes = useQuery(api.lessons.listMyClasses, {});

  const [pickedTermId, setPickedTermId] = useState<Id<"terms"> | null>(null);
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  // Until the admin picks, the active term is the natural default.
  const termId =
    pickedTermId ?? terms?.find((term) => term.active)?._id ?? null;

  const rows = useQuery(
    api.reports.listForClass,
    classId && termId ? { classId, termId } : "skip",
  );

  const generateForClass = useMutation(api.reports.generateForClass);
  const publishAll = useMutation(api.reports.publishAll);
  const publish = useMutation(api.reports.publish);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<CardTarget | null>(null);
  const [previewCardId, setPreviewCardId] =
    useState<Id<"reportCards"> | null>(null);
  const [remarksTarget, setRemarksTarget] = useState<CardTarget | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const termItems = useMemo(
    () =>
      (terms ?? []).map((term) => ({
        value: term._id as string,
        label: term.name,
      })),
    [terms],
  );
  const classItems = useMemo(
    () =>
      (classes ?? []).map((cls) => ({
        value: cls.classId as string,
        label: `${cls.gradeName} · ${cls.className}`,
      })),
    [classes],
  );

  const hasSelection = classId !== null && termId !== null;
  const hasDrafts = (rows ?? []).some((row) => row.status === "draft");

  async function confirmGenerate() {
    if (!classId || !termId) return;
    setActionPending(true);
    try {
      const count = await generateForClass({ classId, termId });
      toast.success(
        t("reports.generateStarted", { count: formatNumber(count) }),
      );
      setGenerateOpen(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  async function confirmPublishAll() {
    if (!classId || !termId) return;
    setActionPending(true);
    try {
      const count = await publishAll({ classId, termId });
      toast.success(t("reports.publishedAll", { count: formatNumber(count) }));
      setPublishAllOpen(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  async function confirmPublish() {
    if (!publishTarget) return;
    setActionPending(true);
    try {
      await publish({ cardId: publishTarget.cardId });
      toast.success(t("reports.published"));
      setPublishTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">{t("reports.title")}</h1>

      {/* Term + class pickers, then the batch actions */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-full max-w-52 flex-col gap-1.5">
          <Label id="reports-term-label">{t("reports.termLabel")}</Label>
          <Select
            items={termItems}
            value={termId}
            onValueChange={(value) =>
              setPickedTermId((value as Id<"terms"> | null) ?? null)
            }
            disabled={terms === undefined}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="reports-term-label"
            >
              <SelectValue placeholder={t("reports.selectTerm")} />
            </SelectTrigger>
            <SelectContent>
              {termItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-full max-w-52 flex-col gap-1.5">
          <Label id="reports-class-label">{t("reports.classLabel")}</Label>
          <Select
            items={classItems}
            value={classId}
            onValueChange={(value) =>
              setClassId((value as Id<"classes"> | null) ?? null)
            }
            disabled={classes === undefined}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="reports-class-label"
            >
              <SelectValue placeholder={t("reports.selectClass")} />
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
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!hasSelection || !hasDrafts || actionPending}
            onClick={() => setPublishAllOpen(true)}
          >
            <Send />
            {t("reports.publishAll")}
          </Button>
          <Button
            disabled={!hasSelection || actionPending}
            onClick={() => setGenerateOpen(true)}
          >
            <RefreshCw />
            {t("reports.generate")}
          </Button>
        </div>
      </div>

      {!hasSelection ? (
        <p className="flex min-h-40 items-center justify-center rounded-xl border text-center text-sm text-muted-foreground">
          {t("reports.pickPrompt")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.colStudent")}</TableHead>
                <TableHead>{t("reports.colAvg")}</TableHead>
                <TableHead>{t("reports.colStatus")}</TableHead>
                <TableHead>{t("reports.colComputedAt")}</TableHead>
                <TableHead className="w-12 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === undefined ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full max-w-32" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t("reports.emptyRoster")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const cardId = row.cardId;
                  return (
                    <TableRow key={row.studentId}>
                      <TableCell className="font-medium">
                        {row.studentName}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.finalAvg !== undefined
                          ? t("reports.pct", {
                              pct: formatNumber(row.finalAvg),
                            })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.computedAt !== undefined
                          ? formatDateTime(row.computedAt)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-end">
                        {cardId === undefined ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t("common.actions")}
                                />
                              }
                            >
                              <EllipsisVertical />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-36">
                              <DropdownMenuItem
                                onClick={() => setPreviewCardId(cardId)}
                              >
                                <Eye />
                                {t("reports.preview")}
                              </DropdownMenuItem>
                              {row.status === "draft" ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setRemarksTarget({
                                      cardId,
                                      studentName: row.studentName,
                                    })
                                  }
                                >
                                  <NotebookPen />
                                  {t("reports.remarks")}
                                </DropdownMenuItem>
                              ) : null}
                              {row.status === "draft" ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setPublishTarget({
                                      cardId,
                                      studentName: row.studentName,
                                    })
                                  }
                                >
                                  <Send />
                                  {t("reports.publish")}
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Preview */}
      <Dialog
        open={previewCardId !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewCardId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("reports.previewTitle")}</DialogTitle>
          </DialogHeader>
          {previewCardId !== null ? (
            <QueryBoundary key={previewCardId}>
              <PreviewBody cardId={previewCardId} />
            </QueryBoundary>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Remarks (draft only) */}
      <Dialog
        open={remarksTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemarksTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("reports.remarksTitle")}</DialogTitle>
            <DialogDescription>
              {remarksTarget?.studentName} — {t("reports.remarksHint")}
            </DialogDescription>
          </DialogHeader>
          {remarksTarget !== null ? (
            <QueryBoundary key={remarksTarget.cardId}>
              <RemarksForm
                target={remarksTarget}
                onClose={() => setRemarksTarget(null)}
              />
            </QueryBoundary>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Generate confirm */}
      <AlertDialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reports.generateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reports.generateConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionPending}
              onClick={confirmGenerate}
            >
              {t("reports.generate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish-all confirm */}
      <AlertDialog open={publishAllOpen} onOpenChange={setPublishAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reports.publishAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reports.publishAllConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionPending}
              onClick={confirmPublishAll}
            >
              {t("reports.publishAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Single publish confirm */}
      <AlertDialog
        open={publishTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPublishTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reports.publishTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reports.publishConfirm", {
                name: publishTarget?.studentName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionPending}
              onClick={confirmPublish}
            >
              {t("reports.publish")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
