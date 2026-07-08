"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/components/form";
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
import { Skeleton } from "@/components/ui/skeleton";
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

  const form = useAppForm({
    defaultValues: {
      scope: canSchoolScope ? "school" : "class",
      classId: null as string | null,
      title: "",
      body: "",
    },
    validators: {
      onSubmit: z
        .object({
          scope: z.string(),
          classId: z.string().nullable(),
          title: z
            .string()
            .trim()
            .min(1, t("common.requiredField"))
            .max(MAX_TITLE_LENGTH, t("common.invalidValue")),
          body: z
            .string()
            .trim()
            .min(1, t("common.requiredField"))
            .max(MAX_BODY_LENGTH, t("common.invalidValue")),
        })
        // Class scope requires a class; school scope ignores it.
        .refine((v) => v.scope !== "class" || !!v.classId, {
          message: t("common.requiredField"),
          path: ["classId"],
        }),
    },
    onSubmit: async ({ value }) => {
      const classId =
        value.scope === "class"
          ? (value.classId as Id<"classes"> | null)
          : null;
      if (value.scope === "class" && !classId) return;
      try {
        await create({
          scope: value.scope as "school" | "class",
          classId: classId ?? undefined,
          title: value.title.trim(),
          body: value.body.trim(),
        });
        toast.success(t("announce.created"));
        onOpenChange(false);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {canSchoolScope ? (
        <form.AppField name="scope">
          {(field) => (
            <field.SelectField
              label={t("announce.scopeLabel")}
              items={scopeItems}
            />
          )}
        </form.AppField>
      ) : null}

      {/* Class picker only when the class scope is selected. */}
      <form.Subscribe selector={(s) => s.values.scope}>
        {(scope) =>
          scope === "class" ? (
            <form.AppField name="classId">
              {(field) => (
                <field.SelectField
                  label={t("announce.classLabel")}
                  placeholder={t("announce.selectClass")}
                  items={classItems}
                  disabled={classes === undefined}
                />
              )}
            </form.AppField>
          ) : null
        }
      </form.Subscribe>

      <form.AppField name="title">
        {(field) => (
          <field.TextField
            label={t("announce.titleLabel")}
            maxLength={MAX_TITLE_LENGTH}
            placeholder={t("announce.titlePlaceholder")}
          />
        )}
      </form.AppField>

      <form.AppField name="body">
        {(field) => (
          <field.TextareaField
            label={t("announce.bodyLabel")}
            rows={5}
            maxLength={MAX_BODY_LENGTH}
            placeholder={t("announce.bodyPlaceholder")}
          />
        )}
      </form.AppField>

      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t("announce.publish")}</form.SubmitButton>
        </form.AppForm>
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
