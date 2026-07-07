"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Megaphone } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

type AnnouncementRow = FunctionReturnType<
  typeof api.announcements.listForStudent
>[number];

function ScopeBadge({ announcement }: { announcement: AnnouncementRow }) {
  if (announcement.scope === "school") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-transparent bg-primary/10 text-primary"
      >
        {t("portal.scopeSchool")}
      </Badge>
    );
  }
  if (!announcement.className) return null;
  return (
    <Badge variant="secondary" className="shrink-0">
      {announcement.className}
    </Badge>
  );
}

function AnnouncementCard({ announcement }: { announcement: AnnouncementRow }) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-bold">{announcement.title}</span>
        <ScopeBadge announcement={announcement} />
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {announcement.body}
      </p>
      <span className="text-xs text-muted-foreground">
        {announcement.authorName} · {formatDateTime(announcement._creationTime)}
      </span>
    </article>
  );
}

export default function PortalAnnouncementsPage() {
  const { sessionToken, ready } = useStudentSession();
  const announcements = useQuery(
    api.announcements.listForStudent,
    ready && sessionToken ? { sessionToken } : "skip",
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("portal.announcementsTitle")}
      </h1>

      {announcements === undefined ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>{t("portal.announcementsEmptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("portal.announcementsEmptyBody")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {announcements.map((announcement) => (
            <AnnouncementCard
              key={announcement._id}
              announcement={announcement}
            />
          ))}
        </div>
      )}
    </div>
  );
}
