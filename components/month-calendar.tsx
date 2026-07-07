"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// M14 — shared month grid of the three calendars (/teacher/calendar,
// /admin/calendar, /portal/calendar). Purely presentational: the pages fetch
// `api.calendar.monthFor…` day buckets, flatten them into the `items` record
// and own selection/month state.

// ——— Types ———

export type CalendarKind =
  | "lesson"
  | "exam"
  | "homework"
  | "holiday"
  | "event";

export type CalendarItem = {
  kind: CalendarKind;
  title: string;
  refId: string;
};

// ——— Date-key helpers (local time, never toISOString which is UTC) ———

function dateKeyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Local "YYYY-MM-DD" key of a Date. */
export function localDateKey(d: Date): string {
  return dateKeyOf(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse a date-key at local midnight so formatDate renders the right day. */
export function dateKeyMs(key: string): number {
  return new Date(`${key}T00:00:00`).getTime();
}

/** First/last day keys of the month containing `monthDate`. */
export function monthRange(monthDate: Date): { from: string; to: string } {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { from: dateKeyOf(year, month, 1), to: dateKeyOf(year, month, lastDay) };
}

/** First day of the month `delta` months away from `monthDate`. */
export function addMonths(monthDate: Date, delta: number): Date {
  return new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1);
}

// ——— Kind → label/style maps ———

const KINDS: ReadonlyArray<CalendarKind> = [
  "lesson",
  "exam",
  "homework",
  "holiday",
  "event",
];

export const KIND_LABEL_KEY: Record<CalendarKind, MessageKey> = {
  lesson: "calendarUi.kindLesson",
  exam: "calendarUi.kindExam",
  homework: "calendarUi.kindHomework",
  holiday: "calendarUi.kindHoliday",
  event: "calendarUi.kindEvent",
};

// The homework dot uses accent-foreground: `--accent` itself is a near-white
// saffron tint in light mode, invisible at 4px.
const KIND_DOT_CLASS: Record<CalendarKind, string> = {
  lesson: "bg-primary",
  exam: "bg-destructive",
  homework: "bg-accent-foreground",
  holiday: "bg-success",
  event: "bg-muted-foreground",
};

export const KIND_BADGE_CLASS: Record<CalendarKind, string> = {
  lesson: "bg-primary/10 text-primary",
  exam: "bg-destructive/10 text-destructive",
  homework: "bg-accent text-accent-foreground",
  holiday: "bg-success/10 text-success",
  event: "bg-muted text-muted-foreground",
};

const WEEKDAY_KEYS: ReadonlyArray<MessageKey> = [
  "calendarUi.weekdaySun",
  "calendarUi.weekdayMon",
  "calendarUi.weekdayTue",
  "calendarUi.weekdayWed",
  "calendarUi.weekdayThu",
  "calendarUi.weekdayFri",
  "calendarUi.weekdaySat",
];

// Gregorian "month YYYY" label, Arabic month names with Latin digits (same
// locale settings as lib/i18n's formatters).
const monthLabelFormat = new Intl.DateTimeFormat("ar-u-ca-gregory-nu-latn", {
  month: "long",
  year: "numeric",
});

const EMPTY_ITEMS: ReadonlyArray<CalendarItem> = [];
const MAX_DOTS = 3;

// ——— Month grid ———

/**
 * One month as a Sunday-first CSS grid (RTL puts Sunday rightmost). Day
 * cells show the date number plus up to 3 kind-colored 4px dots and a "+n"
 * overflow. Today gets a primary ring, the picked day a primary tint. A
 * kind legend sits under the grid; an empty `items` record still renders
 * the full grid.
 */
export function MonthCalendar({
  monthDate,
  items,
  onPickDay,
  selectedDay,
  onMonthChange,
}: {
  monthDate: Date;
  items: Record<string, Array<CalendarItem>>;
  onPickDay: (dateKey: string) => void;
  selectedDay: string | null;
  onMonthChange: (next: Date) => void;
}) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const leadingBlanks = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = localDateKey(new Date());

  return (
    <div className="flex flex-col gap-2">
      {/* Month nav — in RTL "previous" points forward-right, "next" left. */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("calendarUi.prevMonth")}
          onClick={() => onMonthChange(addMonths(monthDate, -1))}
        >
          <ChevronRight />
        </Button>
        <span className="text-sm font-bold">
          {monthLabelFormat.format(monthDate)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("calendarUi.nextMonth")}
          onClick={() => onMonthChange(addMonths(monthDate, 1))}
        >
          <ChevronLeft />
        </Button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_KEYS.map((key) => (
          <span
            key={key}
            className="truncate py-0.5 text-center text-[11px] font-medium text-muted-foreground"
          >
            {t(key)}
          </span>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} aria-hidden />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateKey = dateKeyOf(year, month, day);
          const dayItems = items[dateKey] ?? EMPTY_ITEMS;
          const overflow = dayItems.length - MAX_DOTS;
          const isToday = dateKey === todayKey;
          const isSelected = dateKey === selectedDay;
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onPickDay(dateKey)}
              aria-label={formatDate(dateKeyMs(dateKey))}
              aria-pressed={isSelected}
              className={cn(
                "flex h-12 flex-col items-center justify-center gap-1 rounded-lg outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 md:h-14",
                isToday && "ring-2 ring-primary",
                isSelected && "bg-primary/10",
              )}
            >
              <span
                className={cn(
                  "text-xs leading-none tabular-nums",
                  isToday && "font-black text-primary",
                )}
              >
                {day}
              </span>
              <span className="flex h-2 items-center gap-0.5">
                {dayItems.slice(0, MAX_DOTS).map((item, j) => (
                  <span
                    key={j}
                    aria-hidden
                    className={cn(
                      "size-1 rounded-full",
                      KIND_DOT_CLASS[item.kind],
                    )}
                  />
                ))}
                {overflow > 0 ? (
                  <span className="text-[9px] font-medium leading-none text-muted-foreground">
                    +{overflow}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
        {KINDS.map((kind) => (
          <span
            key={kind}
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", KIND_DOT_CLASS[kind])}
            />
            {t(KIND_LABEL_KEY[kind])}
          </span>
        ))}
      </div>
    </div>
  );
}

// ——— Selected-day item list ———

/**
 * The items of the picked day. `hrefFor` turns an item into a link target
 * (null/omitted = plain row); `itemActions` appends per-row trailing actions
 * (the admin delete button).
 */
export function CalendarDayList({
  selectedDay,
  items,
  hrefFor,
  itemActions,
}: {
  selectedDay: string | null;
  items: Array<CalendarItem>;
  hrefFor?: (item: CalendarItem) => string | null;
  itemActions?: (item: CalendarItem) => React.ReactNode;
}) {
  if (!selectedDay) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
        {t("calendarUi.pickDayHint")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-bold">{formatDate(dateKeyMs(selectedDay))}</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("calendarUi.dayEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((item) => {
            const href = hrefFor?.(item) ?? null;
            const row = (
              <>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 border-transparent",
                    KIND_BADGE_CLASS[item.kind],
                  )}
                >
                  {t(KIND_LABEL_KEY[item.kind])}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {item.title}
                </span>
              </>
            );
            return (
              <li
                key={`${item.kind}-${item.refId}`}
                className="flex items-center gap-2 p-3"
              >
                {href ? (
                  <Link
                    href={href}
                    aria-label={t("calendarUi.openItem", { title: item.title })}
                    className="group flex min-w-0 flex-1 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {row}
                    <ChevronLeft
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary group-focus-visible:text-primary"
                    />
                  </Link>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {row}
                  </span>
                )}
                {itemActions?.(item)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ——— Loading placeholder shared by the three pages ———

export function CalendarSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-96 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
