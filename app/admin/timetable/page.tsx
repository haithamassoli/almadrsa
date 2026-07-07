"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { CalendarDays, Plus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { SlotDialog } from "./slot-dialog";

// The school week: Sunday–Thursday (weekday 0–4).
const WEEKDAYS: Array<{ weekday: number; labelKey: MessageKey }> = [
  { weekday: 0, labelKey: "timetable.sunday" },
  { weekday: 1, labelKey: "timetable.monday" },
  { weekday: 2, labelKey: "timetable.tuesday" },
  { weekday: 3, labelKey: "timetable.wednesday" },
  { weekday: 4, labelKey: "timetable.thursday" },
];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

const cellKey = (weekday: number, period: number) => `${weekday}-${period}`;

export default function TimetablePage() {
  const classes = useQuery(api.lessons.listMyClasses, {});
  const staff = useQuery(api.staff.listStaff, {});

  const [pickedClassId, setPickedClassId] = useState<Id<"classes"> | null>(null);
  // Default to the first class once loaded; derived, not synced via effect.
  const classId = pickedClassId ?? classes?.[0]?.classId ?? null;

  const slots = useQuery(
    api.timetable.listForClass,
    classId ? { classId } : "skip",
  );

  // Which cell's dialog is open (null = closed). The slot is derived below.
  const [cell, setCell] = useState<{ weekday: number; period: number } | null>(
    null,
  );

  const selectedClass = useMemo(
    () => classes?.find((c) => c.classId === classId) ?? null,
    [classes, classId],
  );

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label:
          c.gradeName && c.gradeName !== c.className
            ? `${c.gradeName} — ${c.className}`
            : c.className,
      })),
    [classes],
  );

  // id → name for every staff member (banned included, so historical slots
  // still render a name); the picker itself filters banned out below.
  const teacherNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of staff ?? []) map.set(member.id, member.name);
    return map;
  }, [staff]);

  const teacherOptions = useMemo(
    () =>
      (staff ?? [])
        .filter((member) => !member.banned)
        .map((member) => ({ id: member.id, name: member.name })),
    [staff],
  );

  const subjectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const subject of selectedClass?.subjects ?? [])
      map.set(subject.subjectId, subject.name);
    return map;
  }, [selectedClass]);

  const slotByCell = useMemo(() => {
    const map = new Map<
      string,
      { _id: Id<"timetableSlots">; subjectId: Id<"subjects">; teacherId: string }
    >();
    for (const slot of slots ?? []) {
      map.set(cellKey(slot.weekday, slot.period), {
        _id: slot._id,
        subjectId: slot.subjectId,
        teacherId: slot.teacherId,
      });
    }
    return map;
  }, [slots]);

  const activeSlot =
    cell !== null ? (slotByCell.get(cellKey(cell.weekday, cell.period)) ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("timetable.title")}
        </h1>
        {classItems.length > 0 ? (
          <Select
            items={classItems}
            value={classId ?? ""}
            onValueChange={(value) => setPickedClassId(value as Id<"classes">)}
          >
            <SelectTrigger
              className="min-w-48"
              aria-label={t("timetable.classLabel")}
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
        ) : null}
      </div>

      {classes === undefined ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : classes.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("timetable.noClassesTitle")}</EmptyTitle>
            <EmptyDescription>{t("timetable.noClassesHint")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/admin/structure" />}>
              {t("timetable.noClassesCta")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-16">
                  {t("timetable.period")}
                </TableHead>
                {WEEKDAYS.map((day) => (
                  <TableHead key={day.weekday} className="min-w-32">
                    {t(day.labelKey)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERIODS.map((period) => (
                <TableRow key={period}>
                  <TableCell className="font-medium text-muted-foreground">
                    {formatNumber(period)}
                  </TableCell>
                  {WEEKDAYS.map((day) => {
                    const slot = slotByCell.get(cellKey(day.weekday, period));
                    return (
                      <TableCell
                        key={day.weekday}
                        className="p-1 align-top"
                      >
                        {slots === undefined ? (
                          <Skeleton className="h-14 w-full rounded-lg" />
                        ) : slot ? (
                          <button
                            type="button"
                            onClick={() =>
                              setCell({ weekday: day.weekday, period })
                            }
                            className="flex h-full min-h-14 w-full flex-col justify-center gap-0.5 rounded-lg px-2 py-1.5 text-start transition hover:bg-accent/50"
                          >
                            <span className="font-medium">
                              {subjectNames.get(slot.subjectId) ?? "—"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {teacherNames.get(slot.teacherId) ?? "—"}
                            </span>
                          </button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("timetable.addSlot")}
                            onClick={() =>
                              setCell({ weekday: day.weekday, period })
                            }
                            className="h-14 w-full text-muted-foreground"
                          >
                            <Plus />
                          </Button>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {classId && cell !== null ? (
        <SlotDialog
          key={cellKey(cell.weekday, cell.period)}
          open
          onOpenChange={(open) => {
            if (!open) setCell(null);
          }}
          classId={classId}
          weekday={cell.weekday}
          period={cell.period}
          slot={activeSlot}
          subjects={selectedClass?.subjects ?? []}
          teachers={teacherOptions}
        />
      ) : null}
    </div>
  );
}
