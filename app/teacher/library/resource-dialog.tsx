"use client";

import { useMemo } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

  const form = useAppForm({
    defaultValues: {
      title: resource?.title ?? "",
      url: resource?.url ?? "",
      subjectId: (resource?.subjectId ?? null) as string | null,
      scope: resource?.classId !== undefined ? SCOPE_CLASS : SCOPE_ALL,
      classId: (resource?.classId ?? null) as string | null,
    },
    validators: {
      onSubmit: z.object({
        title: z
          .string()
          .trim()
          .min(1, t("common.requiredField"))
          .max(200, t("common.invalidValue")),
        url: z
          .string()
          .trim()
          .min(1, t("common.requiredField"))
          .max(2048, t("common.invalidValue"))
          // http(s)/scheme check mirroring the old native type="url" gate;
          // the server further restricts to http(s) ("invalid_resource").
          .refine(
            (v) => v === "" || z.url().safeParse(v).success,
            t("common.invalidValue"),
          ),
        subjectId: z.string().nullable(),
        scope: z.string(),
        classId: z.string().nullable(),
      }),
    },
    onSubmit: async ({ value }) => {
      if (!value.subjectId) return;
      // classId only travels with the "specific class" scope.
      const classId =
        value.scope === SCOPE_CLASS && value.classId
          ? (value.classId as Id<"classes">)
          : undefined;
      try {
        if (resource === null) {
          await create({
            title: value.title,
            url: value.url,
            subjectId: value.subjectId as Id<"subjects">,
            classId,
          });
          toast.success(t("library.created"));
        } else {
          await update({
            resourceId: resource._id,
            title: value.title,
            url: value.url,
            subjectId: value.subjectId as Id<"subjects">,
            classId,
          });
          toast.success(t("library.updated"));
        }
        onOpenChange(false);
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

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

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <form.AppField name="title">
        {(field) => (
          <field.TextField label={t("library.fieldTitle")} maxLength={200} />
        )}
      </form.AppField>

      <form.AppField name="url">
        {(field) => (
          <field.TextField
            label={t("library.fieldUrl")}
            dir="ltr"
            type="url"
            maxLength={2048}
            placeholder="https://"
          />
        )}
      </form.AppField>

      <form.AppField name="subjectId">
        {(field) => (
          <field.SelectField
            label={t("library.fieldSubject")}
            placeholder={t("library.selectSubject")}
            items={subjectItems}
          />
        )}
      </form.AppField>

      <form.AppField name="scope">
        {(field) => (
          <field.SelectField
            label={t("library.fieldScope")}
            items={scopeItems}
          />
        )}
      </form.AppField>

      {/* Class picker only when the resource is scoped to one class. */}
      <form.Subscribe selector={(s) => s.values.scope}>
        {(scope) =>
          scope === SCOPE_CLASS ? (
            <form.AppField name="classId">
              {(field) => (
                <field.SelectField
                  label={t("library.fieldClass")}
                  placeholder={t("library.selectClass")}
                  items={classItems}
                />
              )}
            </form.AppField>
          ) : null
        }
      </form.Subscribe>

      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <form.AppForm>
          <form.Subscribe
            selector={(s) =>
              !s.values.subjectId ||
              (s.values.scope === SCOPE_CLASS && !s.values.classId)
            }
          >
            {(incomplete) => (
              <form.SubmitButton disabled={incomplete}>
                {t("common.save")}
              </form.SubmitButton>
            )}
          </form.Subscribe>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
