"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, t } from "@/lib/i18n";
import { mutationErrorText } from "./announcements-errors";

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;

type AnnouncementRow = {
  _id: Id<"announcements">;
  scope: "school" | "class";
  className?: string;
  title: string;
  body: string;
  authorName: string;
  mine: boolean;
  _creationTime: number;
};

// ——— Compose dialog ———

function ComposeForm({
  canSchoolScope,
  onOpenChange,
}: {
  canSchoolScope: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.announcements.create);
  const classes = useQuery(api.lessons.listMyClasses, {});

  const [scope, setScope] = useState<"school" | "class">(
    canSchoolScope ? "school" : "class",
  );
  const [classValue, setClassValue] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  const scopeItems = useMemo(
    () =>
      canSchoolScope
        ? [
            { value: "school", label: t("announce.scopeSchool") },
            { value: "class", label: t("announce.scopeClass") },
          ]
        : [{ value: "class", label: t("announce.scopeClass") }],
    [canSchoolScope],
  );
  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const classId =
      scope === "class" ? (classValue as Id<"classes"> | null) : null;
    if (scope === "class" && !classId) return;
    setPending(true);
    try {
      await create({
        scope,
        classId: classId ?? undefined,
        title: title.trim(),
        body: body.trim(),
      });
      toast.success(t("announce.created"));
      onOpenChange(false);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {canSchoolScope ? (
        <div className="flex flex-col gap-2">
          <Label id="announce-scope-label">{t("announce.scopeLabel")}</Label>
          <Select
            items={scopeItems}
            value={scope}
            onValueChange={(value) => setScope(value as "school" | "class")}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="announce-scope-label"
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
      ) : null}

      {scope === "class" ? (
        <div className="flex flex-col gap-2">
          <Label id="announce-class-label">{t("announce.classLabel")}</Label>
          <Select
            items={classItems}
            value={classValue}
            onValueChange={(value) => setClassValue((value as string) ?? null)}
            disabled={classes === undefined}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="announce-class-label"
            >
              <SelectValue placeholder={t("announce.selectClass")} />
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
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="announce-title">{t("announce.titleLabel")}</Label>
        <Input
          id="announce-title"
          required
          maxLength={MAX_TITLE_LENGTH}
          placeholder={t("announce.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="announce-body">{t("announce.bodyLabel")}</Label>
        <Textarea
          id="announce-body"
          required
          maxLength={MAX_BODY_LENGTH}
          rows={5}
          placeholder={t("announce.bodyPlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
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
          disabled={
            pending ||
            title.trim().length === 0 ||
            body.trim().length === 0 ||
            (scope === "class" && !classValue)
          }
        >
          {pending ? <Spinner /> : null}
          {t("announce.publish")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ComposeDialog({
  canSchoolScope,
  open,
  onOpenChange,
}: {
  canSchoolScope: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("announce.dialogTitle")}</DialogTitle>
        </DialogHeader>
        {/* Keyed remount resets the form each time the dialog opens. */}
        {open ? (
          <ComposeForm
            canSchoolScope={canSchoolScope}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ——— Announcement card ———

function AnnouncementCard({
  announcement,
  canDelete,
  onDelete,
}: {
  announcement: AnnouncementRow;
  canDelete: boolean;
  onDelete: (announcement: AnnouncementRow) => void;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          {announcement.scope === "school" ? (
            <Badge variant="default">{t("announce.badgeSchool")}</Badge>
          ) : (
            <Badge variant="secondary">{announcement.className ?? "—"}</Badge>
          )}
          {canDelete ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="-me-1 -mt-1 text-muted-foreground hover:text-destructive"
              aria-label={t("announce.deleteAnnouncement")}
              onClick={() => onDelete(announcement)}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
        <h2 className="font-bold">{announcement.title}</h2>
        <p className="line-clamp-4 text-sm whitespace-pre-wrap text-foreground/90">
          {announcement.body}
        </p>
        <span className="text-xs text-muted-foreground">
          {announcement.authorName} ·{" "}
          {formatDateTime(announcement._creationTime)}
        </span>
      </CardContent>
    </Card>
  );
}

// ——— Board ———

export function AnnouncementsBoard({
  canSchoolScope,
}: {
  canSchoolScope: boolean;
}) {
  const announcements = useQuery(api.announcements.listBoard, {});
  const removeAnnouncement = useMutation(api.announcements.remove);
  const [composeOpen, setComposeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementRow | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setPending(true);
    try {
      await removeAnnouncement({ announcementId: deleteTarget._id });
      toast.success(t("announce.deleted"));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("announce.title")}
        </h1>
        <Button onClick={() => setComposeOpen(true)}>
          <Plus />
          {t("announce.newAnnouncement")}
        </Button>
      </div>

      {announcements === undefined ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="rounded-2xl">
              <CardContent className="flex flex-col gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>{t("announce.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("announce.emptyBody")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setComposeOpen(true)}>
              <Plus />
              {t("announce.newAnnouncement")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {announcements.map((announcement) => (
            <AnnouncementCard
              key={announcement._id}
              announcement={announcement}
              canDelete={announcement.mine || canSchoolScope}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <ComposeDialog
        canSchoolScope={canSchoolScope}
        open={composeOpen}
        onOpenChange={setComposeOpen}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("announce.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("announce.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
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
