"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, MessageSquare } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadView } from "@/components/thread-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

type ThreadRow = FunctionReturnType<typeof api.messages.studentThreads>[number];

function ThreadListItem({
  thread,
  onOpen,
}: {
  thread: ThreadRow;
  onOpen: (threadId: Id<"threads">) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.threadId)}
      className="flex items-center gap-3 rounded-xl border p-3 text-start outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/50 text-primary"
      >
        <MessageSquare className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">
            {thread.teacherName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDate(thread.lastMessageAt)}
          </span>
        </div>
        {thread.lastPreview ? (
          <span className="truncate text-sm text-muted-foreground">
            {thread.lastPreview}
          </span>
        ) : null}
      </div>
      {thread.unread > 0 ? (
        <Badge
          className="shrink-0 tabular-nums"
          aria-label={t("messagesPortal.unreadCount", {
            count: formatNumber(thread.unread),
          })}
        >
          {formatNumber(thread.unread)}
        </Badge>
      ) : null}
    </button>
  );
}

export default function PortalMessagesPage() {
  const { sessionToken, ready } = useStudentSession();
  const [openId, setOpenId] = useState<Id<"threads"> | null>(null);
  const threads = useQuery(
    api.messages.studentThreads,
    ready && sessionToken ? { sessionToken } : "skip",
  );

  // Conversation view — full-width, back button, ThreadView owns its composer.
  if (openId && sessionToken) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setOpenId(null)}
        >
          <ArrowRight className="size-4" aria-hidden />
          {t("messagesPortal.back")}
        </Button>
        <ThreadView threadId={openId} sessionToken={sessionToken} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("messagesPortal.title")}
      </h1>

      {threads === undefined ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyTitle>{t("messagesPortal.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("messagesPortal.emptyHint")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {threads.map((thread) => (
            <ThreadListItem
              key={thread.threadId}
              thread={thread}
              onOpen={setOpenId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
