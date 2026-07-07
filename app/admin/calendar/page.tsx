"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
import { mutationErrorText } from "./errors";
import { EventDialog } from "./event-dialog";

export default function AdminCalendarPage() {
  const classes = useQuery(api.academics.listAllClasses, {});
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    localDateKey(new Date()),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CalendarItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const { from, to } = monthRange(monthDate);
  const month = useQuery(
    api.calendar.monthForStaff,
    classId ? { classId, from, to } : "skip",
  );
  const removeEvent = useMutation(api.events.remove);

  const items = useMemo(() => {
    const map: Record<string, Array<CalendarItem>> = {};
    for (const day of month ?? []) map[day.date] = day.items;
    return map;
  }, [month]);

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c._id as string,
        label: `${c.gradeName} · ${c.name}`,
      })),
    [classes],
  );

  function onMonthChange(next: Date) {
    setMonthDate(next);
    setSelectedDay(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await removeEvent({ eventId: deleteTarget.refId as Id<"events"> });
      toast.success(t("calendarUi.eventDeleted"));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("calendarUi.title")}
        </h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus />
          {t("calendarUi.addEvent")}
        </Button>
      </div>

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
              {/* Admins are redirected off /teacher routes, so items stay
                  plain; holidays/events get a delete action instead. */}
              <CalendarDayList
                selectedDay={selectedDay}
                items={selectedDay ? (items[selectedDay] ?? []) : []}
                itemActions={(item) =>
                  item.kind === "holiday" || item.kind === "event" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("calendarUi.deleteEventAria", {
                        title: item.title,
                      })}
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  ) : null
                }
              />
            </>
          )}
        </div>
      )}

      {/* Add holiday/event */}
      <EventDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        classes={classes}
        defaultDate={selectedDay ?? localDateKey(new Date())}
      />

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("calendarUi.deleteEventTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("calendarUi.deleteEventConfirm", {
                title: deleteTarget?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletePending}
              onClick={confirmDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
