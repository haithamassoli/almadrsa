"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { CalendarDays } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CalendarDayList,
  CalendarSkeleton,
  MonthCalendar,
  localDateKey,
  monthRange,
  type CalendarItem,
} from "@/components/month-calendar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { t } from "@/lib/i18n";

// Lessons/exams/homework route to their teacher pages; holidays/events are
// informational. (Backend refId semantics: see convex/calendar.ts.)
function hrefForTeacher(item: CalendarItem): string | null {
  switch (item.kind) {
    case "lesson":
      return `/teacher/lessons/${item.refId}`;
    case "exam":
      return `/teacher/exams/${item.refId}`;
    case "homework":
      return `/teacher/homework/${item.refId}`;
    default:
      return null;
  }
}

export default function TeacherCalendarPage() {
  const classes = useQuery(api.lessons.listMyClasses, {});
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    localDateKey(new Date()),
  );

  const { from, to } = monthRange(monthDate);
  const month = useQuery(
    api.calendar.monthForStaff,
    classId ? { classId, from, to } : "skip",
  );

  const items = useMemo(() => {
    const map: Record<string, Array<CalendarItem>> = {};
    for (const day of month ?? []) map[day.date] = day.items;
    return map;
  }, [month]);

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );

  function onMonthChange(next: Date) {
    setMonthDate(next);
    setSelectedDay(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("calendarUi.title")}
      </h1>

      <div className="flex min-w-56 max-w-xs flex-col gap-1.5">
        <Label id="cal-class-label">{t("calendarUi.classLabel")}</Label>
        <Select
          items={classItems}
          value={classId}
          onValueChange={(value) =>
            setClassId((value as Id<"classes"> | null) ?? null)
          }
          disabled={classes === undefined}
        >
          <SelectTrigger className="w-full" aria-labelledby="cal-class-label">
            <SelectValue placeholder={t("calendarUi.selectClass")} />
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

      {!classId ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>{t("calendarUi.pickClassTitle")}</EmptyTitle>
            <EmptyDescription>{t("calendarUi.pickClassBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex w-full max-w-xl flex-col gap-4">
          {month === undefined ? (
            <CalendarSkeleton />
          ) : (
            <>
              <div className="rounded-2xl border bg-card p-3 md:p-4">
                <MonthCalendar
                  monthDate={monthDate}
                  items={items}
                  onPickDay={setSelectedDay}
                  selectedDay={selectedDay}
                  onMonthChange={onMonthChange}
                />
              </div>
              <CalendarDayList
                selectedDay={selectedDay}
                items={selectedDay ? (items[selectedDay] ?? []) : []}
                hrefFor={hrefForTeacher}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
