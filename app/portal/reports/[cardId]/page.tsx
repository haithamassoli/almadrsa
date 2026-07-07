"use client";

import { Component } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { ArrowRight, CircleAlert, FileDown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ReportCardView } from "@/components/report-card-view";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";
import { errorCode } from "../../errors";

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="h-[32rem] rounded-2xl" />
    </div>
  );
}

/** Deep link to a card the student cannot open: friendly full-screen state. */
function RefusedState({ code }: { code: string }) {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlert />
        </EmptyMedia>
        <EmptyTitle>{t("reports.cannotOpenTitle")}</EmptyTitle>
        <EmptyDescription>
          {code === "not_found"
            ? t("reports.errNotFound")
            : t("common.errorGeneric")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/portal/reports" />}
        >
          <ArrowRight />
          {t("reports.backToReports")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Renders getForStudent's render-time throws (not_found on a bad deep link,
 * a draft, or someone else's card) as the refused state instead of the route
 * error page.
 */
class QueryErrorBoundary extends Component<
  { children: ReactNode },
  { code: string | null }
> {
  state: { code: string | null } = { code: null };
  static getDerivedStateFromError(error: unknown): { code: string } {
    return { code: errorCode(error) ?? "unknown" };
  }
  render() {
    return this.state.code !== null ? (
      <RefusedState code={this.state.code} />
    ) : (
      this.props.children
    );
  }
}

function ReportDetail({
  sessionToken,
  cardId,
}: {
  sessionToken: string;
  cardId: Id<"reportCards">;
}) {
  const card = useQuery(api.reports.getForStudent, { sessionToken, cardId });
  if (card === undefined) return <DetailSkeleton />;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="print-hide flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/portal/reports" />}
        >
          <ArrowRight />
          {t("reports.backToReports")}
        </Button>
        {/* The print stylesheet leaves only the sheet visible, so the
            browser's save-as-PDF IS the PDF export (native Arabic shaping). */}
        <Button size="sm" onClick={() => window.print()}>
          <FileDown />
          {t("reports.downloadPdf")}
        </Button>
      </div>
      <ReportCardView card={card} />
    </div>
  );
}

export default function PortalReportDetailPage() {
  const params = useParams<{ cardId: string }>();
  const cardId = params.cardId as Id<"reportCards">;
  const { sessionToken, ready } = useStudentSession();
  if (!ready || !sessionToken) return <DetailSkeleton />;
  return (
    // Keyed so navigating between cards resets any caught error.
    <QueryErrorBoundary key={cardId}>
      <ReportDetail sessionToken={sessionToken} cardId={cardId} />
    </QueryErrorBoundary>
  );
}
