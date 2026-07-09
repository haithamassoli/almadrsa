"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, t } from "@/lib/i18n";
import { makeErrors } from "@/lib/errors";
import { cn } from "@/lib/utils";

const MAX_MESSAGE_LENGTH = 2000;

// convex/messages.ts throws `invalid_message` and `not_found`.
const { mutationErrorText } = makeErrors({
  invalid_message: "messagesUi.errInvalidMessage",
  not_found: "messagesUi.errNotFound",
});

type ThreadViewProps = {
  threadId: Id<"threads">;
  /** Student/parent portal session — omit for staff callers. */
  sessionToken?: string;
};

/**
 * One conversation: counterpart header, chronological bubbles, composer.
 * Dual-auth like the backend: with `sessionToken` the caller is the thread's
 * student side, without it the signed-in staff member — own messages are
 * rendered end-aligned accordingly.
 */
export function ThreadView({ threadId, sessionToken }: ThreadViewProps) {
  const data = useQuery(api.messages.thread, { threadId, sessionToken });
  const markRead = useMutation(api.messages.markRead);

  const ownSenderType = sessionToken === undefined ? "staff" : "student";
  const messages = data?.messages;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Zero the caller's unread counter on open and again whenever a new
  // message lands while the thread is on screen. The ref keeps unrelated
  // re-renders from re-firing (markRead is also idempotent server-side).
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (messages === undefined) return;
    const newest = messages[messages.length - 1];
    const marker = `${threadId}:${newest?._id ?? "empty"}`;
    if (markedRef.current === marker) return;
    markedRef.current = marker;
    markRead({ threadId, sessionToken }).catch(() => {
      // Read receipts are best-effort — never surface their failures.
    });
  }, [messages, threadId, sessionToken, markRead]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      {/* Counterpart header */}
      <div className="border-b px-4 py-3">
        {data === undefined ? (
          <Skeleton className="h-5 w-32" />
        ) : (
          <h2 className="text-sm font-bold">{data.counterpartName}</h2>
        )}
      </div>

      {/* Chronological bubbles */}
      <div
        ref={scrollRef}
        role="log"
        aria-label={t("messagesUi.conversation")}
        className="flex max-h-[60vh] min-h-64 flex-col gap-3 overflow-y-auto p-4"
      >
        {data === undefined ? (
          <>
            <Skeleton className="h-10 w-3/5 self-start rounded-2xl" />
            <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
            <Skeleton className="h-10 w-2/5 self-start rounded-2xl" />
          </>
        ) : data.messages.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">
            {t("messagesUi.emptyThread")}
          </p>
        ) : (
          data.messages.map((message) => {
            const own = message.senderType === ownSenderType;
            return (
              <div
                key={message._id}
                className={cn(
                  "flex max-w-[85%] flex-col gap-1",
                  own ? "items-end self-end" : "items-start self-start",
                )}
              >
                <p
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
                    own ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {message.text}
                </p>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(message.sentAt)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Composer — keyed by thread so switching threads drops the draft
          (the old code cleared `text` on a threadId change during render). */}
      <Composer
        key={threadId}
        threadId={threadId}
        sessionToken={sessionToken}
        disabled={data === undefined}
      />
    </div>
  );
}

function Composer({
  threadId,
  sessionToken,
  disabled,
}: {
  threadId: Id<"threads">;
  sessionToken?: string;
  disabled: boolean;
}) {
  const send = useMutation(api.messages.send);

  const form = useAppForm({
    defaultValues: { text: "" },
    validators: {
      onSubmit: z.object({
        text: z.string().trim().min(1, t("common.requiredField")),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        await send({ threadId, text: value.text.trim(), sessionToken });
        form.reset();
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    // Mirror the send button's gate: no empty sends, no double-submits.
    if (form.state.isSubmitting || form.state.values.text.trim().length === 0) {
      return;
    }
    void form.handleSubmit();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex items-end gap-2 border-t p-3"
    >
      <form.AppField name="text">
        {(field) => (
          <Textarea
            maxLength={MAX_MESSAGE_LENGTH}
            rows={1}
            className="max-h-32 min-h-9 flex-1"
            placeholder={t("messagesUi.composerPlaceholder")}
            aria-label={t("messagesUi.composerLabel")}
            value={field.state.value}
            onChange={(event) => field.handleChange(event.target.value)}
            onKeyDown={onComposerKeyDown}
            disabled={disabled}
          />
        )}
      </form.AppField>
      <form.Subscribe
        selector={(s) => ({
          isSubmitting: s.isSubmitting,
          empty: s.values.text.trim().length === 0,
        })}
      >
        {({ isSubmitting, empty }) => (
          <Button
            type="submit"
            size="icon"
            aria-label={t("messagesUi.send")}
            disabled={isSubmitting || disabled || empty}
          >
            <Send className="rtl:-scale-x-100" />
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
