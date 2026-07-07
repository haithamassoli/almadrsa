"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

/** Row shape returned by api.lessons.listMyClasses. */
type TeachableClass = {
  classId: Id<"classes">;
  className: string;
  gradeName: string;
  subjects: Array<{ subjectId: Id<"subjects">; name: string }>;
};

const NONE = "";

/** Create a lesson outside the timetable (ad-hoc). */
export function AdhocDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
}) {
  const classes = useQuery(api.lessons.listMyClasses, open ? {} : "skip");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("lessons.adhocDialogTitle")}</DialogTitle>
        </DialogHeader>
        {/* Conditional mount: every open starts from fresh form state. */}
        {open ? (
          <AdhocForm
            classes={classes}
            defaultDate={defaultDate}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AdhocForm({
  classes,
  defaultDate,
  onOpenChange,
}: {
  classes: TeachableClass[] | undefined;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
}) {
  const createAdHoc = useMutation(api.lessons.createAdHoc);

  const [classValue, setClassValue] = useState<string>(NONE);
  const [subjectValue, setSubjectValue] = useState<string>(NONE);
  const [date, setDate] = useState(defaultDate);
  const [period, setPeriod] = useState("1");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);

  const classItems = useMemo(
    () => [
      { value: NONE, label: t("lessons.choosePlaceholder") },
      ...(classes ?? []).map((c) => ({
        value: c.classId as string,
        label: c.className,
      })),
    ],
    [classes],
  );

  const selectedClass = (classes ?? []).find((c) => c.classId === classValue);
  const subjectItems = useMemo(
    () => [
      { value: NONE, label: t("lessons.choosePlaceholder") },
      ...(selectedClass?.subjects ?? []).map((s) => ({
        value: s.subjectId as string,
        label: s.name,
      })),
    ],
    [selectedClass],
  );

  function onClassChange(value: string) {
    setClassValue(value);
    // Single teachable subject: pre-select it, otherwise ask again.
    const cls = (classes ?? []).find((c) => c.classId === value);
    setSubjectValue(
      cls && cls.subjects.length === 1
        ? (cls.subjects[0].subjectId as string)
        : NONE,
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (classValue === NONE || subjectValue === NONE) return;
    setPending(true);
    try {
      await createAdHoc({
        classId: classValue as Id<"classes">,
        subjectId: subjectValue as Id<"subjects">,
        date,
        period: Number(period),
        title: title.trim() || undefined,
      });
      toast.success(t("lessons.adhocCreated"));
      onOpenChange(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label id="adhoc-class-label">{t("lessons.classLabel")}</Label>
        <Select
          items={classItems}
          value={classValue}
          onValueChange={(value) => onClassChange(value as string)}
        >
          <SelectTrigger
            aria-labelledby="adhoc-class-label"
            className="w-full"
            disabled={classes === undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {classItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label id="adhoc-subject-label">{t("lessons.subjectLabel")}</Label>
        <Select
          items={subjectItems}
          value={subjectValue}
          onValueChange={(value) => setSubjectValue(value as string)}
        >
          <SelectTrigger
            aria-labelledby="adhoc-subject-label"
            className="w-full"
            disabled={selectedClass === undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {subjectItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="adhoc-date">{t("lessons.dateLabel")}</Label>
          <Input
            id="adhoc-date"
            type="date"
            dir="ltr"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="adhoc-period">{t("lessons.periodLabel")}</Label>
          <Input
            id="adhoc-period"
            type="number"
            dir="ltr"
            inputMode="numeric"
            required
            min={1}
            max={8}
            step={1}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="adhoc-title">{t("lessons.titleLabel")}</Label>
        <Input
          id="adhoc-title"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={pending || classValue === NONE || subjectValue === NONE}
        >
          {pending ? <Spinner /> : null}
          {t("common.add")}
        </Button>
      </DialogFooter>
    </form>
  );
}
