"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n";
import { GradeSelect } from "../structure/grade-select";

type WeightsRowData = {
  subjectId: Id<"subjects">;
  subjectName: string;
  examsPct?: number;
  homeworkPct?: number;
  participationPct?: number;
};

function weightsError(err: unknown): string {
  const code =
    err instanceof ConvexError && typeof err.data === "string" ? err.data : "";
  return code === "weights_sum"
    ? t("weights.errWeightsSum")
    : t("common.errorGeneric");
}

function parsePct(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function WeightsRow({ row }: { row: WeightsRowData }) {
  const setWeights = useMutation(api.academics.setWeights);
  const [exams, setExams] = useState(
    row.examsPct !== undefined ? String(row.examsPct) : "",
  );
  const [homework, setHomework] = useState(
    row.homeworkPct !== undefined ? String(row.homeworkPct) : "",
  );
  const [participation, setParticipation] = useState(
    row.participationPct !== undefined ? String(row.participationPct) : "",
  );
  const [saving, setSaving] = useState(false);

  const examsN = parsePct(exams);
  const homeworkN = parsePct(homework);
  const participationN = parsePct(participation);
  const allValid =
    examsN !== null && homeworkN !== null && participationN !== null;
  const sum = allValid ? examsN + homeworkN + participationN : null;
  const canSave = allValid && sum === 100 && !saving;
  const isSet = row.examsPct !== undefined;

  async function onSave() {
    if (!canSave || examsN === null || homeworkN === null || participationN === null) {
      return;
    }
    setSaving(true);
    try {
      await setWeights({
        subjectId: row.subjectId,
        examsPct: examsN,
        homeworkPct: homeworkN,
        participationPct: participationN,
      });
      toast.success(t("weights.saved", { name: row.subjectName }));
    } catch (err) {
      toast.error(weightsError(err));
    } finally {
      setSaving(false);
    }
  }

  const inputProps = {
    type: "number" as const,
    dir: "ltr" as const,
    inputMode: "numeric" as const,
    min: 0,
    max: 100,
    step: 1,
    className: "w-20 text-center",
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="font-medium">{row.subjectName}</span>
          {!isSet ? (
            <Badge variant="outline" className="w-fit text-xs">
              {t("weights.notSet")}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Input
          {...inputProps}
          aria-label={t("weights.exams")}
          value={exams}
          onChange={(e) => setExams(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          {...inputProps}
          aria-label={t("weights.homework")}
          value={homework}
          onChange={(e) => setHomework(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          {...inputProps}
          aria-label={t("weights.participation")}
          value={participation}
          onChange={(e) => setParticipation(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Badge
          variant={sum === 100 ? "secondary" : "destructive"}
          title={t("weights.sumHint")}
          className="tabular-nums"
        >
          <span dir="ltr">{sum === null ? "—" : sum}/100</span>
        </Badge>
      </TableCell>
      <TableCell className="text-end">
        <Button size="sm" disabled={!canSave} onClick={onSave}>
          {saving ? <Spinner className="size-3.5" /> : null}
          {t("weights.save")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function WeightsPage() {
  const grades = useQuery(api.academics.listGrades);
  const [pickedGradeId, setGradeId] = useState<Id<"grades"> | null>(null);
  // Default to the first grade once loaded; derived, not synced via effect.
  const gradeId = pickedGradeId ?? grades?.[0]?._id ?? null;

  const rows = useQuery(
    api.academics.listWeightsForGrade,
    gradeId ? { gradeId } : "skip",
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="heading-rule text-2xl font-black">
          {t("weights.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("weights.description")}
        </p>
      </div>

      {grades !== undefined && grades.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Scale aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("weights.noGrades")}</EmptyTitle>
            <EmptyDescription>{t("weights.noGradesHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <GradeSelect grades={grades} value={gradeId} onChange={setGradeId} />

          {!gradeId || rows === undefined ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Scale aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{t("weights.noSubjects")}</EmptyTitle>
                <EmptyDescription>
                  {t("weights.noSubjectsHint")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("weights.subject")}</TableHead>
                    <TableHead>{t("weights.exams")}</TableHead>
                    <TableHead>{t("weights.homework")}</TableHead>
                    <TableHead>{t("weights.participation")}</TableHead>
                    <TableHead>{t("weights.sum")}</TableHead>
                    <TableHead className="w-24 text-end">
                      {t("weights.save")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <WeightsRow
                      // Re-seed local input state when grade or data identity
                      // changes.
                      key={row.subjectId}
                      row={row}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
