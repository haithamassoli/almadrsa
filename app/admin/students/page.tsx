"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  EllipsisVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { ImportDialog } from "./import-dialog";
import { StudentDialog } from "./student-dialog";
import type { StudentRow } from "./types";

const ALL = "all";

export default function StudentsPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [classFilter, setClassFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StudentRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<StudentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentRow | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const classes = useQuery(api.academics.listAllClasses, {});
  const students = useQuery(api.students.listStudents, {
    classId:
      classFilter !== ALL ? (classFilter as Id<"classes">) : undefined,
    status:
      statusFilter !== ALL
        ? (statusFilter as "active" | "archived")
        : undefined,
    search: deferredSearch.trim() || undefined,
  });

  const archiveStudent = useMutation(api.students.archiveStudent);
  const deleteStudent = useMutation(api.students.deleteStudent);

  const classItems = useMemo(
    () => [
      { value: ALL, label: t("students.allClasses") },
      ...(classes ?? []).map((c) => ({ value: c._id as string, label: c.name })),
    ],
    [classes],
  );
  const statusItems = useMemo(
    () => [
      { value: ALL, label: t("students.allStatuses") },
      { value: "active", label: t("common.active") },
      { value: "archived", label: t("common.archived") },
    ],
    [],
  );

  async function confirmArchive() {
    if (!archiveTarget) return;
    setActionPending(true);
    try {
      await archiveStudent({ studentId: archiveTarget._id });
      toast.success(t("students.archived"));
      setArchiveTarget(null);
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
      await deleteStudent({ studentId: deleteTarget._id });
      toast.success(t("students.deleted"));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("students.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload />
            {t("students.importCsv")}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("students.addStudent")}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="ps-8"
            placeholder={t("students.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("common.search")}
          />
        </div>
        <Select
          items={classItems}
          value={classFilter}
          onValueChange={(value) => setClassFilter(value as string)}
        >
          <SelectTrigger
            className="min-w-40"
            aria-label={t("students.classFilter")}
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
          items={statusItems}
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as string)}
        >
          <SelectTrigger
            className="min-w-28"
            aria-label={t("students.statusFilter")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {students !== undefined ? (
          <p className="ms-auto text-sm text-muted-foreground">
            {t("students.count", { count: students.length })}
          </p>
        ) : null}
      </div>

      {/* Roster table */}
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("students.fullName")}</TableHead>
              <TableHead>{t("students.class")}</TableHead>
              <TableHead>{t("students.guardianName")}</TableHead>
              <TableHead>{t("students.guardianPhone")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead className="w-12 text-end">
                <span className="sr-only">{t("common.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students === undefined ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : students.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-muted-foreground"
                >
                  {t("students.empty")}
                </TableCell>
              </TableRow>
            ) : (
              students.map((student) => (
                <TableRow key={student._id}>
                  <TableCell className="font-medium">
                    {student.firstName} {student.lastName}
                  </TableCell>
                  <TableCell>{student.className ?? "—"}</TableCell>
                  <TableCell>{student.guardianName ?? "—"}</TableCell>
                  <TableCell>
                    {student.guardianPhone ? (
                      <span dir="ltr">{student.guardianPhone}</span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        student.status === "active" ? "default" : "secondary"
                      }
                    >
                      {student.status === "active"
                        ? t("common.active")
                        : t("common.archived")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
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
                          onClick={() => setEditTarget(student)}
                        >
                          <Pencil />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        {student.status === "active" ? (
                          <DropdownMenuItem
                            onClick={() => setArchiveTarget(student)}
                          >
                            <Archive />
                            {t("students.archive")}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(student)}
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

      {/* Create / edit */}
      <StudentDialog
        open={createOpen || editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
        student={editTarget}
        classes={classes}
      />

      {/* CSV import */}
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {/* Archive confirm */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("students.archiveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("students.archiveConfirm", {
                name: archiveTarget
                  ? `${archiveTarget.firstName} ${archiveTarget.lastName}`
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionPending}
              onClick={confirmArchive}
            >
              {t("students.archive")}
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
            <AlertDialogTitle>{t("students.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("students.deleteConfirm", {
                name: deleteTarget
                  ? `${deleteTarget.firstName} ${deleteTarget.lastName}`
                  : "",
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
