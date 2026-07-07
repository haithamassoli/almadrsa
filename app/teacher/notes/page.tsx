"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { GraduationCap, MessageSquarePlus, Trash2, Users } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

const MAX_NOTE_LENGTH = 1000;

type NoteRow = {
  _id: Id<"notes">;
  text: string;
  teacherId: string;
  teacherName: string;
  mine: boolean;
  _creationTime: number;
};

function CenteredEmpty({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ——— Composer ———

function NoteComposer({ studentId }: { studentId: Id<"students"> }) {
  const create = useMutation(api.notes.create);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    try {
      await create({ studentId, text: trimmed });
      toast.success(t("notes.created"));
      setText("");
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Label htmlFor="note-text">{t("notes.composerTitle")}</Label>
          <Textarea
            id="note-text"
            required
            maxLength={MAX_NOTE_LENGTH}
            rows={3}
            placeholder={t("notes.composerPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || text.trim().length === 0}>
              <MessageSquarePlus />
              {t("notes.addNote")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ——— Note card ———

function NoteCard({
  note,
  onDelete,
}: {
  note: NoteRow;
  onDelete: (note: NoteRow) => void;
}) {
  return (
    <Card size="sm" className="rounded-2xl">
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm whitespace-pre-wrap">{note.text}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {note.teacherName} · {formatDateTime(note._creationTime)}
          </span>
          {note.mine ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              aria-label={t("notes.deleteNote")}
              onClick={() => onDelete(note)}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ——— Notes list ———

function NotesList({ studentId }: { studentId: Id<"students"> }) {
  const notes = useQuery(api.notes.listByStudent, { studentId });
  const removeNote = useMutation(api.notes.remove);
  const [deleteTarget, setDeleteTarget] = useState<NoteRow | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setPending(true);
    try {
      await removeNote({ noteId: deleteTarget._id });
      toast.success(t("notes.deleted"));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  if (notes === undefined) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} size="sm" className="rounded-2xl">
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <CenteredEmpty
        icon={<MessageSquarePlus />}
        title={t("notes.noNotesTitle")}
        body={t("notes.noNotesBody")}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {notes.map((note) => (
          <NoteCard key={note._id} note={note} onDelete={setDeleteTarget} />
        ))}
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("notes.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("notes.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={confirmDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ——— Page ———

export default function NotesPage() {
  const classes = useQuery(api.lessons.listMyClasses, {});
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  const [studentId, setStudentId] = useState<Id<"students"> | null>(null);

  const students = useQuery(
    api.students.listStudents,
    classId ? { classId, status: "active" } : "skip",
  );

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );
  const studentItems = useMemo(
    () =>
      (students ?? []).map((s) => ({
        value: s._id as string,
        label: `${s.firstName} ${s.lastName}`,
      })),
    [students],
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">{t("notes.title")}</h1>

      {/* Class + student pickers */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label id="notes-class-label">{t("notes.classLabel")}</Label>
          <Select
            items={classItems}
            value={classId}
            onValueChange={(value) => {
              setClassId((value as Id<"classes"> | null) ?? null);
              setStudentId(null);
            }}
            disabled={classes === undefined}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="notes-class-label"
            >
              <SelectValue placeholder={t("notes.selectClass")} />
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
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label id="notes-student-label">{t("notes.studentLabel")}</Label>
          <Select
            items={studentItems}
            value={studentId}
            onValueChange={(value) =>
              setStudentId((value as Id<"students"> | null) ?? null)
            }
            disabled={!classId || students === undefined}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="notes-student-label"
            >
              <SelectValue placeholder={t("notes.selectStudent")} />
            </SelectTrigger>
            <SelectContent>
              {studentItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!classId ? (
        <CenteredEmpty
          icon={<GraduationCap />}
          title={t("notes.pickClassTitle")}
          body={t("notes.pickClassBody")}
        />
      ) : !studentId ? (
        <CenteredEmpty
          icon={<Users />}
          title={t("notes.pickStudentTitle")}
          body={t("notes.pickStudentBody")}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Remount composer + list when the student changes. */}
          <NoteComposer key={`composer-${studentId}`} studentId={studentId} />
          <NotesList key={`list-${studentId}`} studentId={studentId} />
        </div>
      )}
    </div>
  );
}
