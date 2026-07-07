"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ChevronLeft, FileText } from "lucide-react";
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
import { formatDate, formatNumber, t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

export default function PortalReportsPage() {
  const { sessionToken, ready } = useStudentSession();
  const cards = useQuery(
    api.reports.listForStudent,
    ready && sessionToken ? { sessionToken } : "skip",
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">{t("reports.title")}</h1>

      {cards === undefined ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>{t("reports.portalEmptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("reports.portalEmptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <Link
              key={card.cardId}
              href={`/portal/reports/${card.cardId}`}
              className="flex items-center gap-3 rounded-xl border p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{card.termName}</span>
                {card.publishedAt !== undefined ? (
                  <span className="text-xs text-muted-foreground">
                    {t("reports.publishedAtLine", {
                      date: formatDate(card.publishedAt),
                    })}
                  </span>
                ) : null}
              </div>
              {card.finalAvg !== undefined ? (
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {t("reports.pct", { pct: formatNumber(card.finalAvg) })}
                </Badge>
              ) : null}
              <ChevronLeft
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
