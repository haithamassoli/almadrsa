"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  EllipsisVertical,
  Lock,
  NotebookPen,
  Plus,
  Trash2,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { cn } from "@/lib/utils";
import { mutationErrorText } from "./errors";
import { HomeworkDialog, HomeworkStatusBadge } from "./homework-dialog";

type HomeworkRow = FunctionReturnType<typeof api.homework.listMine>[number];

const ALL = "all";

export default function TeacherHomeworkPage() {
  const router = useRouter();
  const [classFilter, setClassFilter] = useState<string>(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<HomeworkRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HomeworkRow | null>(null);
  const [actionPending, setActionPending] = useState(false);
  // Frozen at mount (render must stay pure) — deadline coloring only.
  const [now] = useState(() => Date.now());

  const classes = useQuery(api.lessons.listMyClasses, {});
  const homeworkList = useQuery(api.homework.listMine, {
    classId: classFilter !== ALL ? (classFilter as Id<"classes">) : undefined,
  });

  const closeHomework = useMutation(api.homework.closeNow);
  const removeHomework = useMutation(api.homework.remove);

  const classItems = useMemo(
    () => [
      { value: ALL, label: t("homework.allClasses") },
      ...(classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    ],
    [classes],
  );

  async function confirmClose() {
    if (!closeTarget) return;
    setActionPending(true);
    try {
      await closeHomework({ homeworkId: closeTarget._id });
      toast.success(t("homework.closedToast"));
      setCloseTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setActionPending(true);
    try {
      await removeHomework({ homeworkId: deleteTarget._id });
      toast.success(t("homework.deleted"));
      setDeleteTarget(null);
    } catch (error) {
      // has_submissions maps to "close it instead" — the dialog stays open.
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("homework.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={classItems}
            value={classFilter}
            onValueChange={(value) => setClassFilter(value as string)}
          >
            <SelectTrigger
              className="min-w-40"
              aria-label={t("homework.classFilter")}
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
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("homework.newHomework")}
          </Button>
        </div>
      </div>

      {homeworkList !== undefined &&
      homeworkList.length === 0 &&
      classFilter === ALL ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookPen />
            </EmptyMedia>
            <EmptyTitle>{t("homework.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("homework.emptyBody")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t("homework.newHomework")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("homework.colTitle")}</TableHead>
                <TableHead>{t("homework.colClass")}</TableHead>
                <TableHead>{t("homework.colSubject")}</TableHead>
                <TableHead>{t("homework.colDeadline")}</TableHead>
                <TableHead>{t("homework.colMarks")}</TableHead>
                <TableHead>{t("homework.colSubmitted")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-12 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {homeworkList === undefined ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full max-w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : homeworkList.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t("homework.emptyFiltered")}
                  </TableCell>
                </TableRow>
              ) : (
                homeworkList.map((homework) => (
                  <TableRow
                    key={homework._id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/teacher/homework/${homework._id}`)
                    }
                  >
                    <TableCell className="max-w-56 font-medium">
                      <Link
                        href={`/teacher/homework/${homework._id}`}
                        className="line-clamp-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        aria-label={t("homework.openHomework", {
                          title: homework.title,
                        })}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {homework.title}
                      </Link>
                    </TableCell>
                    <TableCell>{homework.className}</TableCell>
                    <TableCell>{homework.subjectName}</TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap",
                        homework.deadline < now
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {formatDateTime(homework.deadline)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatNumber(homework.marks)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatNumber(homework.submittedCount)}/
                      {formatNumber(homework.enrolledCount)}
                    </TableCell>
                    <TableCell>
                      <HomeworkStatusBadge status={homework.status} />
                    </TableCell>
                    <TableCell
                      className="text-end"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                          {homework.status === "open" ? (
                            <DropdownMenuItem
                              onClick={() => setCloseTarget(homework)}
                            >
                              <Lock />
                              {t("homework.closeNow")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteTarget(homework)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create */}
      <HomeworkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        homework={null}
      />

      {/* Close-now confirm */}
      <AlertDialog
        open={closeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCloseTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("homework.closeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("homework.closeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionPending}
              onClick={confirmClose}
            >
              {t("homework.closeNow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("homework.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("homework.deleteConfirmBody", {
                title: deleteTarget?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionPending}
              onClick={confirmDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
