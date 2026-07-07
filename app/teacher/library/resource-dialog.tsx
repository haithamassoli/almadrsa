"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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

type ResourceRow = FunctionReturnType<typeof api.library.listForStaff>[number];
type MyClasses = FunctionReturnType<typeof api.lessons.listMyClasses>;

const SCOPE_ALL = "all";
const SCOPE_CLASS = "class";

/** Create (resource == null) or edit a library resource. */
export function ResourceDialog({
  open,
  onOpenChange,
  resource,
  classes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: ResourceRow | null;
  classes: MyClasses | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {resource === null
              ? t("library.addResource")
              : t("library.editResource")}
          </DialogTitle>
        </DialogHeader>
        {/* Keyed remount reseeds form state on each open / different row. */}
        {open ? (
          <ResourceForm
            key={resource?._id ?? "new"}
            resource={resource}
            classes={classes}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResourceForm({
  resource,
  classes,
  onOpenChange,
}: {
  resource: ResourceRow | null;
  classes: MyClasses | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.library.create);
  const update = useMutation(api.library.update);

  const [title, setTitle] = useState(resource?.title ?? "");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [subjectValue, setSubjectValue] = useState<string>(
    resource?.subjectId ?? "",
  );
  const [scope, setScope] = useState<string>(
    resource?.classId !== undefined ? SCOPE_CLASS : SCOPE_ALL,
  );
  const [classValue, setClassValue] = useState<string>(resource?.classId ?? "");
  const [pending, setPending] = useState(false);

  // Union of the caller's subjects across every class (deduped by id).
  const subjectItems = useMemo(() => {
    const byId = new Map<string, string>();
    for (const cls of classes ?? []) {
      for (const subject of cls.subjects) {
        byId.set(subject.subjectId, subject.name);
      }
    }
    return [...byId.entries()].map(([value, label]) => ({ value, label }));
  }, [classes]);

  const classItems = useMemo(
    () =>
      (classes ?? []).map((cls) => ({
        value: cls.classId as string,
        label: `${cls.gradeName} · ${cls.className}`,
      })),
    [classes],
  );

  const scopeItems = useMemo(
    () => [
      { value: SCOPE_ALL, label: t("library.scopeWholeGrade") },
      { value: SCOPE_CLASS, label: t("library.scopeSpecificClass") },
    ],
    [],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const classId =
      scope === SCOPE_CLASS && classValue
        ? (classValue as Id<"classes">)
        : undefined;
    try {
      if (resource === null) {
        await create({
          title,
          url,
          subjectId: subjectValue as Id<"subjects">,
          classId,
        });
        toast.success(t("library.created"));
      } else {
        await update({
          resourceId: resource._id,
          title,
          url,
          subjectId: subjectValue as Id<"subjects">,
          classId,
        });
        toast.success(t("library.updated"));
      }
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
        <Label htmlFor="resource-title">{t("library.fieldTitle")}</Label>
        <Input
          id="resource-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="resource-url">{t("library.fieldUrl")}</Label>
        <Input
          id="resource-url"
          dir="ltr"
          type="url"
          required
          maxLength={2048}
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label id="resource-subject-label">{t("library.fieldSubject")}</Label>
        <Select
          items={subjectItems}
          value={subjectValue}
          onValueChange={(value) => setSubjectValue(value as string)}
        >
          <SelectTrigger
            aria-labelledby="resource-subject-label"
            className="w-full"
          >
            <SelectValue placeholder={t("library.selectSubject")} />
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
      <div className="flex flex-col gap-2">
        <Label id="resource-scope-label">{t("library.fieldScope")}</Label>
        <Select
          items={scopeItems}
          value={scope}
          onValueChange={(value) => setScope(value as string)}
        >
          <SelectTrigger
            aria-labelledby="resource-scope-label"
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
      {scope === SCOPE_CLASS ? (
        <div className="flex flex-col gap-2">
          <Label id="resource-class-label">{t("library.fieldClass")}</Label>
          <Select
            items={classItems}
            value={classValue}
            onValueChange={(value) => setClassValue(value as string)}
          >
            <SelectTrigger
              aria-labelledby="resource-class-label"
              className="w-full"
            >
              <SelectValue placeholder={t("library.selectClass")} />
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
            subjectValue === "" ||
            (scope === SCOPE_CLASS && classValue === "")
          }
        >
          {pending ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
