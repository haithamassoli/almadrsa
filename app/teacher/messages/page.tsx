"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, MessagesSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/components/form";
import { ThreadView } from "@/components/thread-view";
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
  EmptyContent,
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
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "./errors";

type ThreadRow = FunctionReturnType<typeof api.messages.teacherThreads>[number];

// ——— Thread list row ———

function ThreadListRow({
  thread,
  active,
  onOpen,
}: {
  thread: ThreadRow;
  active: boolean;
  onOpen: (threadId: Id<"threads">) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.threadId)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-xl border p-3 text-start transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "border-primary/40 bg-accent",
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {thread.studentName}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDateTime(thread.lastMessageAt)}
        </span>
      </div>
      <div className="flex w-full items-center gap-2">
        <span className="line-clamp-1 min-w-0 flex-1 text-sm text-muted-foreground">
          {thread.lastPreview || t("messagesUi.emptyThread")}
        </span>
        {thread.unread > 0 ? (
          <Badge
            className="shrink-0 rounded-full bg-destructive text-white tabular-nums"
            aria-label={t("messagesUi.unreadCount", {
              count: formatNumber(thread.unread),
            })}
          >
            {formatNumber(thread.unread)}
          </Badge>
        ) : null}
      </div>
    </button>
  );
}

// ——— New-conversation dialog ———

function NewThreadForm({
  onOpened,
  onOpenChange,
}: {
  onOpened: (threadId: Id<"threads">) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const classes = useQuery(api.lessons.listMyClasses, {});
  // Ephemeral filter that narrows the student list; never submitted itself.
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  const students = useQuery(
    api.students.listStudents,
    classId ? { classId, status: "active" } : "skip",
  );
  const openThread = useMutation(api.messages.openThread);

  const form = useAppForm({
    defaultValues: { studentId: null as string | null },
    validators: {
      onSubmit: z.object({ studentId: z.string().nullable() }),
    },
    onSubmit: async ({ value }) => {
      if (!value.studentId) return;
      try {
        const threadId = await openThread({
          studentId: value.studentId as Id<"students">,
        });
        onOpened(threadId);
        onOpenChange(false);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

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
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label id="messages-class-label">{t("messagesUi.classLabel")}</Label>
        <Select
          items={classItems}
          value={classId}
          onValueChange={(value) => {
            setClassId((value as Id<"classes"> | null) ?? null);
            form.setFieldValue("studentId", null);
          }}
          disabled={classes === undefined}
        >
          <SelectTrigger
            className="w-full"
            aria-labelledby="messages-class-label"
          >
            <SelectValue placeholder={t("messagesUi.selectClass")} />
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

      <form.AppField name="studentId">
        {(field) => (
          <field.SelectField
            label={t("messagesUi.studentLabel")}
            placeholder={t("messagesUi.selectStudent")}
            items={studentItems}
            disabled={!classId || students === undefined}
          />
        )}
      </form.AppField>

      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <form.AppForm>
          <form.Subscribe selector={(s) => !s.values.studentId}>
            {(noStudent) => (
              <form.SubmitButton disabled={noStudent}>
                {t("messagesUi.startConversation")}
              </form.SubmitButton>
            )}
          </form.Subscribe>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}

function NewThreadDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (threadId: Id<"threads">) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("messagesUi.newThread")}</DialogTitle>
        </DialogHeader>
        {/* Keyed remount resets the pickers each time the dialog opens. */}
        {open ? (
          <NewThreadForm onOpened={onOpened} onOpenChange={onOpenChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ——— Page ———

export default function TeacherMessagesPage() {
  const threads = useQuery(api.messages.teacherThreads, {});
  const [selectedId, setSelectedId] = useState<Id<"threads"> | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("messagesUi.title")}
        </h1>
        <Button onClick={() => setNewOpen(true)}>
          <Plus />
          {t("messagesUi.newThread")}
        </Button>
      </div>

      {threads === undefined ? (
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <Skeleton className="hidden h-80 rounded-2xl md:block" />
        </div>
      ) : threads.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessagesSquare />
            </EmptyMedia>
            <EmptyTitle>{t("messagesUi.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("messagesUi.emptyBody")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setNewOpen(true)}>
              <Plus />
              {t("messagesUi.newThread")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Thread list — hidden on mobile while a conversation is open. */}
          <div
            className={cn(
              "flex-col gap-2",
              selectedId ? "hidden md:flex" : "flex",
            )}
          >
            {threads.map((thread) => (
              <ThreadListRow
                key={thread.threadId}
                thread={thread}
                active={thread.threadId === selectedId}
                onOpen={setSelectedId}
              />
            ))}
          </div>

          {/* Conversation pane — full-width with a back button on mobile. */}
          <div
            className={cn(
              "flex-col gap-3",
              selectedId ? "flex" : "hidden md:flex",
            )}
          >
            {selectedId ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start md:hidden"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowRight aria-hidden />
                  {t("common.back")}
                </Button>
                <ThreadView key={selectedId} threadId={selectedId} />
              </>
            ) : (
              <div className="flex min-h-64 items-center justify-center rounded-2xl border">
                <p className="text-sm text-muted-foreground">
                  {t("messagesUi.selectThreadBody")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <NewThreadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onOpened={setSelectedId}
      />
    </div>
  );
}
