"use client";

import type { Id } from "@/convex/_generated/dataModel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

export function GradeSelect({
  grades,
  value,
  onChange,
}: {
  grades: Array<{ _id: Id<"grades">; name: string }> | undefined;
  value: Id<"grades"> | null;
  onChange: (gradeId: Id<"grades">) => void;
}) {
  if (grades === undefined) {
    return <Skeleton className="h-8 w-48" />;
  }
  return (
    <Select
      items={grades.map((g) => ({ label: g.name, value: g._id }))}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as Id<"grades">);
      }}
    >
      <SelectTrigger className="w-48" aria-label={t("structure.selectGrade")}>
        <SelectValue placeholder={t("structure.selectGrade")} />
      </SelectTrigger>
      <SelectContent>
        {grades.map((grade) => (
          <SelectItem key={grade._id} value={grade._id}>
            {grade.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
