"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  BookMarked,
  EllipsisVertical,
  ExternalLink,
  Pencil,
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
import { t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";
import { ResourceDialog } from "./resource-dialog";

type ResourceRow = FunctionReturnType<typeof api.library.listForStaff>[number];

const ALL = "all";

export default function TeacherLibraryPage() {
  const [classFilter, setClassFilter] = useState<string>(ALL);
  const [subjectFilter, setSubjectFilter] = useState<string>(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ResourceRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResourceRow | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const user = useQuery(api.staff.currentUser);
  const classes = useQuery(api.lessons.listMyClasses, {});
  const resources = useQuery(api.library.listForStaff, {
    classId: classFilter !== ALL ? (classFilter as Id<"classes">) : undefined,
    subjectId:
      subjectFilter !== ALL ? (subjectFilter as Id<"subjects">) : undefined,
  });

  const removeResource = useMutation(api.library.remove);

  const classItems = useMemo(
    () => [
      { value: ALL, label: t("library.allClasses") },
      ...(classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    ],
    [classes],
  );

  const subjectItems = useMemo(() => {
    const byId = new Map<string, string>();
    for (const cls of classes ?? []) {
      for (const subject of cls.subjects) {
        byId.set(subject.subjectId, subject.name);
      }
    }
    return [
      { value: ALL, label: t("library.allSubjects") },
      ...[...byId.entries()].map(([value, label]) => ({ value, label })),
    ];
  }, [classes]);

  function canManage(resource: ResourceRow): boolean {
    return (
      user?.role === "admin" || (user?.id !== undefined && user.id === resource.teacherId)
    );
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setActionPending(true);
    try {
      await removeResource({ resourceId: deleteTarget._id });
      toast.success(t("library.deleted"));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  const filtered = classFilter !== ALL || subjectFilter !== ALL;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("library.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={classItems}
            value={classFilter}
            onValueChange={(value) => setClassFilter(value as string)}
          >
            <SelectTrigger
              className="min-w-40"
              aria-label={t("library.classFilter")}
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
          <Select
            items={subjectItems}
            value={subjectFilter}
            onValueChange={(value) => setSubjectFilter(value as string)}
          >
            <SelectTrigger
              className="min-w-40"
              aria-label={t("library.subjectFilter")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {subjectItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("library.addResource")}
          </Button>
        </div>
      </div>

      {resources !== undefined && resources.length === 0 && !filtered ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookMarked />
            </EmptyMedia>
            <EmptyTitle>{t("library.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("library.emptyBody")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t("library.addResource")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("library.colTitle")}</TableHead>
                <TableHead>{t("library.colSubject")}</TableHead>
                <TableHead>{t("library.colScope")}</TableHead>
                <TableHead className="w-12 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources === undefined ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full max-w-32" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : resources.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t("library.emptyFiltered")}
                  </TableCell>
                </TableRow>
              ) : (
                resources.map((resource) => (
                  <TableRow key={resource._id}>
                    <TableCell className="max-w-72 font-medium">
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        aria-label={t("library.openResource", {
                          title: resource.title,
                        })}
                      >
                        <span className="line-clamp-1">{resource.title}</span>
                        <ExternalLink
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </a>
                    </TableCell>
                    <TableCell>{resource.subjectName}</TableCell>
                    <TableCell>
                      {resource.className ?? (
                        <span className="text-muted-foreground">
                          {t("library.forAllSections")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {canManage(resource) ? (
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
                              onClick={() => setEditTarget(resource)}
                            >
                              <Pencil />
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(resource)}
                            >
                              <Trash2 />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / edit */}
      <ResourceDialog
        open={createOpen || editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
        resource={editTarget}
        classes={classes}
      />

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
              {t("library.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("library.deleteConfirmBody", {
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
