"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BookMarked, ExternalLink } from "lucide-react";
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
import { t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

type ResourceRow = FunctionReturnType<
  typeof api.library.listForStudent
>[number];

export default function PortalLibraryPage() {
  const { sessionToken, ready } = useStudentSession();
  const resources = useQuery(
    api.library.listForStudent,
    ready && sessionToken ? { sessionToken } : "skip",
  );

  // Group the newest-first rows by subject, preserving first-seen order.
  const groups = useMemo(() => {
    if (resources === undefined) return undefined;
    const bySubject = new Map<string, ResourceRow[]>();
    for (const resource of resources) {
      const list = bySubject.get(resource.subjectName);
      if (list) list.push(resource);
      else bySubject.set(resource.subjectName, [resource]);
    }
    return [...bySubject.entries()].map(([subjectName, items]) => ({
      subjectName,
      items,
    }));
  }, [resources]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("library.portalTitle")}
      </h1>

      {groups === undefined ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookMarked />
            </EmptyMedia>
            <EmptyTitle>{t("library.portalEmptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("library.portalEmptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.subjectName} className="flex flex-col gap-2">
              <h2 className="text-sm font-bold text-muted-foreground">
                {group.subjectName}
              </h2>
              <div className="flex flex-col gap-2">
                {group.items.map((resource) => (
                  <a
                    key={resource._id}
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {resource.title}
                    </span>
                    {resource.className !== undefined ? (
                      <Badge variant="secondary" className="shrink-0">
                        {resource.className}
                      </Badge>
                    ) : null}
                    <ExternalLink
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
