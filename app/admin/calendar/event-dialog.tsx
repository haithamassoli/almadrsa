"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
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

const SCHOOL_WIDE = "school";

export type ClassOption = {
  _id: Id<"classes">;
  name: string;
  gradeName: string;
};

/** Admin-only: add a holiday or school event to the calendar. */
export function EventDialog({
  open,
  onOpenChange,
  classes,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: Array<ClassOption> | undefined;
  defaultDate: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("calendarUi.addEvent")}</DialogTitle>
        </DialogHeader>
        {/* Keyed remount: each open starts from fresh initial state. */}
        {open ? (
          <EventForm
            key={defaultDate}
            classes={classes}
            defaultDate={defaultDate}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  classes,
  defaultDate,
  onOpenChange,
}: {
  classes: Array<ClassOption> | undefined;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
}) {
  const createEvent = useMutation(api.events.create);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"holiday" | "event">("event");
  const [date, setDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState("");
  const [scope, setScope] = useState<string>(SCHOOL_WIDE);
  const [pending, setPending] = useState(false);

  const kindItems = useMemo(
    () => [
      { value: "event", label: t("calendarUi.kindEvent") },
      { value: "holiday", label: t("calendarUi.kindHoliday") },
    ],
    [],
  );
  const scopeItems = useMemo(
    () => [
      { value: SCHOOL_WIDE, label: t("calendarUi.scopeSchool") },
      ...(classes ?? []).map((c) => ({
        value: c._id as string,
        label: `${c.gradeName} · ${c.name}`,
      })),
    ],
    [classes],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await createEvent({
        title,
        kind,
        date,
        endDate: endDate || undefined,
        classId:
          scope !== SCHOOL_WIDE ? (scope as Id<"classes">) : undefined,
      });
      toast.success(t("calendarUi.eventCreated"));
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
        <Label htmlFor="event-title">{t("calendarUi.eventTitleLabel")}</Label>
        <Input
          id="event-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label id="event-kind-label">{t("calendarUi.eventKindLabel")}</Label>
        <Select
          items={kindItems}
          value={kind}
          onValueChange={(value) => setKind(value as "holiday" | "event")}
        >
          <SelectTrigger aria-labelledby="event-kind-label" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kindItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-date">{t("calendarUi.eventDateLabel")}</Label>
          <Input
            id="event-date"
            type="date"
            dir="ltr"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-end-date">
            {t("calendarUi.eventEndDateLabel")}
          </Label>
          <Input
            id="event-end-date"
            type="date"
            dir="ltr"
            min={date || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label id="event-scope-label">{t("calendarUi.eventScopeLabel")}</Label>
        <Select
          items={scopeItems}
          value={scope}
          onValueChange={(value) => setScope(value as string)}
        >
          <SelectTrigger
            aria-labelledby="event-scope-label"
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scopeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
