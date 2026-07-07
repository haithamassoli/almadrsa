"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CalendarDayList,
  CalendarSkeleton,
  MonthCalendar,
  localDateKey,
  monthRange,
  type CalendarItem,
} from "@/components/month-calendar";
import { t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

// Exams and homework open their portal detail pages; lessons, holidays and
// events are informational. (Backend refId semantics: see convex/calendar.ts.)
function hrefForStudent(item: CalendarItem): string | null {
  switch (item.kind) {
    case "exam":
      return `/portal/exams/${item.refId}`;
    case "homework":
      return `/portal/homework/${item.refId}`;
    default:
      return null;
  }
}

export default function PortalCalendarPage() {
  const { sessionToken, ready } = useStudentSession();
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    localDateKey(new Date()),
  );

  const { from, to } = monthRange(monthDate);
  const month = useQuery(
    api.calendar.monthForStudent,
    ready && sessionToken ? { sessionToken, from, to } : "skip",
  );

  const items = useMemo(() => {
    const map: Record<string, Array<CalendarItem>> = {};
    for (const day of month ?? []) map[day.date] = day.items;
    return map;
  }, [month]);

  function onMonthChange(next: Date) {
    setMonthDate(next);
    setSelectedDay(null);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("calendarUi.title")}
      </h1>

      {month === undefined ? (
        <CalendarSkeleton />
      ) : (
        <div className="flex flex-col gap-4">
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
            hrefFor={hrefForStudent}
          />
        </div>
      )}
    </div>
  );
}
