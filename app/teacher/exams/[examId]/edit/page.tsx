"use client";

import { Component, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { ArrowRight, Lock, SearchX } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { ExamForm } from "../../exam-form";

export default function EditExamPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId as Id<"exams">;
  return (
    // Keyed so navigating to another exam resets a caught failure.
    <ExamErrorBoundary key={examId}>
      <EditView examId={examId} />
    </ExamErrorBoundary>
  );
}

/**
 * api.exams.get throws (not_found / validation) for missing, foreign or
 * malformed ids; convex/react rethrows during render, so a boundary turns
 * all of those into one friendly not-found state.
 */
class ExamErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <ExamNotFound />;
    return this.props.children;
  }
}

function ExamNotFound() {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{t("exams.notFoundTitle")}</EmptyTitle>
        <EmptyDescription>{t("exams.notFoundBody")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/teacher/exams" />}
        >
          <ArrowRight />
          {t("exams.backToList")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function EditView({ examId }: { examId: Id<"exams"> }) {
  const exam = useQuery(api.exams.get, { examId });

  if (exam === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  // Only drafts are editable — published/closed exams stay as they are.
  if (exam.status !== "draft") {
    return (
      <Empty className="flex-1 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Lock />
          </EmptyMedia>
          <EmptyTitle>{t("exams.notEditableTitle")}</EmptyTitle>
          <EmptyDescription>{t("exams.notEditableBody")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/teacher/exams/${examId}`} />}
          >
            <ArrowRight />
            {t("exams.backToExam")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          nativeButton={false}
          render={
            <Link
              href={`/teacher/exams/${examId}`}
              aria-label={t("exams.backToExam")}
            />
          }
        >
          <ArrowRight />
        </Button>
        <h1 className="heading-rule text-2xl font-black">
          {t("exams.editExamTitle")}
        </h1>
      </div>
      {/* Keyed so a different exam id remounts fresh form state. */}
      <ExamForm key={exam._id} exam={exam} />
    </div>
  );
}
