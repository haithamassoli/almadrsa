"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { ExamForm } from "../exam-form";

export default function NewExamPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          nativeButton={false}
          render={
            <Link href="/teacher/exams" aria-label={t("exams.backToList")} />
          }
        >
          <ArrowRight />
        </Button>
        <h1 className="heading-rule text-2xl font-black">
          {t("exams.createExam")}
        </h1>
      </div>
      <ExamForm />
    </div>
  );
}
