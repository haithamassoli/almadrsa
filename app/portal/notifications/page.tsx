"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "../errors";

type NotificationRow = FunctionReturnType<
  typeof api.notifications.list
>[number];

/** markAllRead patches at most this many rows per call (server batch size). */
const MARK_ALL_BATCH = 200;

/** Where a notification leads; null means it stays on this screen. */
function notificationHref(notification: NotificationRow): string | null {
  if (notification.refType === "exam" && notification.refId) {
    return `/portal/exams/${notification.refId}`;
  }
  if (notification.refType === "announcement") return "/portal/announcements";
  if (notification.refType === "attendance") return "/portal/attendance";
  return null;
}

function NotificationItem({
  notification,
  onOpen,
}: {
  notification: NotificationRow;
  onOpen: (notification: NotificationRow) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn(
        "flex w-full flex-col gap-1 rounded-xl border p-3 text-start outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        !notification.read && "border-s-2 border-s-primary bg-primary/5",
      )}
    >
      <span className="font-medium">{notification.title}</span>
      {notification.body ? (
        <span className="text-sm text-muted-foreground">
          {notification.body}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {formatDateTime(notification._creationTime)}
      </span>
    </button>
  );
}

export default function PortalNotificationsPage() {
  const router = useRouter();
  const { sessionToken, ready } = useStudentSession();
  const notifications = useQuery(
    api.notifications.list,
    ready && sessionToken ? { sessionToken } : "skip",
  );
  const markReadMutation = useMutation(api.notifications.markRead);
  const markAllReadMutation = useMutation(api.notifications.markAllRead);
  const [markingAll, setMarkingAll] = useState(false);

  const hasUnread = (notifications ?? []).some(
    (notification) => !notification.read,
  );

  async function markAll(): Promise<void> {
    if (!sessionToken) return;
    setMarkingAll(true);
    try {
      // A full batch means there may be more — keep going until it drains.
      let patched = MARK_ALL_BATCH;
      while (patched === MARK_ALL_BATCH) {
        patched = await markAllReadMutation({ sessionToken });
      }
      toast.success(t("portal.markAllReadDone"));
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setMarkingAll(false);
    }
  }

  function openNotification(notification: NotificationRow): void {
    if (!sessionToken) return;
    if (!notification.read) {
      // Fire-and-forget: marking read is cosmetic and idempotent; navigation
      // must not wait on it.
      markReadMutation({
        sessionToken,
        notificationId: notification._id,
      }).catch(() => {});
    }
    const href = notificationHref(notification);
    if (href) router.push(href);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("portal.notificationsTitle")}
        </h1>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasUnread || markingAll}
          onClick={() => void markAll()}
        >
          {markingAll ? <Spinner /> : <CheckCheck aria-hidden />}
          {t("portal.markAllRead")}
        </Button>
      </div>

      {notifications === undefined ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bell />
            </EmptyMedia>
            <EmptyTitle>{t("portal.notificationsEmptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("portal.notificationsEmptyBody")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification._id}
              notification={notification}
              onOpen={openNotification}
            />
          ))}
        </div>
      )}
    </div>
  );
}
