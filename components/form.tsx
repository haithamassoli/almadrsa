"use client";

import * as React from "react";
import {
  createFormHook,
  createFormHookContexts,
} from "@tanstack/react-form";
import { z } from "zod";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Shared @tanstack/react-form setup: one `useAppForm` bound to the app's UI
// primitives so every migrated form is a schema + a few pre-wired fields, not
// hand-rolled useState. Validation lives in per-form Zod schemas (t()-localized
// messages); the <form> carries noValidate so Zod is the single source of truth.

export const {
  fieldContext,
  formContext,
  useFieldContext,
  useFormContext,
} = createFormHookContexts();

/**
 * Zod check for a numeric `<input>` whose form value stays a string (parsed
 * with Number() at submit, like the pre-migration code). Kept a string so the
 * schema's input type matches the field — z.coerce.number() would not.
 */
export function numberString(
  opts: { int?: boolean; min?: number; max?: number; required?: boolean } = {},
) {
  const { int = false, min, max, required = true } = opts;
  const base = required
    ? z.string().trim().min(1, t("common.requiredField"))
    : z.string();
  return base.refine(
    (raw) => {
      const value = raw.trim();
      if (value === "") return !required;
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      if (int && !Number.isInteger(n)) return false;
      if (min !== undefined && n < min) return false;
      if (max !== undefined && n > max) return false;
      return true;
    },
    { message: t("common.invalidValue") },
  );
}

/** First validation issue for the current field (Standard Schema → message). */
function useFieldMessage(): string | undefined {
  const field = useFieldContext<unknown>();
  if (!field.state.meta.isTouched) return undefined;
  const first = field.state.meta.errors[0] as
    | string
    | { message?: string }
    | undefined;
  if (!first) return undefined;
  return typeof first === "string" ? first : first.message;
}

function FieldError() {
  const message = useFieldMessage();
  return message ? (
    <p className="text-sm text-destructive">{message}</p>
  ) : null;
}

type TextFieldProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "onBlur" | "id" | "name"
> & { label?: React.ReactNode };

/** Text/email/password/number/datetime-local — all string-valued inputs. */
function TextField({ label, className, ...props }: TextFieldProps) {
  const field = useFieldContext<string>();
  // Unique DOM id (not field.name): several forms with the same field names can
  // render on one page, and id must be unique for label→input to associate.
  const id = React.useId();
  const invalid = field.state.meta.isTouched && field.state.meta.errors.length > 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Input
        id={id}
        name={field.name}
        value={field.state.value ?? ""}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid || undefined}
        {...props}
      />
      <FieldError />
    </div>
  );
}

type TextareaFieldProps = Omit<
  React.ComponentProps<typeof Textarea>,
  "value" | "onChange" | "onBlur" | "id" | "name"
> & { label?: React.ReactNode };

function TextareaField({ label, className, ...props }: TextareaFieldProps) {
  const field = useFieldContext<string>();
  const id = React.useId();
  const invalid = field.state.meta.isTouched && field.state.meta.errors.length > 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Textarea
        id={id}
        name={field.name}
        value={field.state.value ?? ""}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid || undefined}
        {...props}
      />
      <FieldError />
    </div>
  );
}

type SelectFieldProps = {
  label?: React.ReactNode;
  placeholder?: React.ReactNode;
  items: ReadonlyArray<{ value: string; label: React.ReactNode }>;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Fires with the picked value (null when cleared) before form state updates. */
  onValueChange?: (value: string | null) => void;
  "aria-label"?: string;
};

/** Base UI Select bound to a `string | null` field (null = nothing picked). */
function SelectField({
  label,
  placeholder,
  items,
  disabled,
  className,
  triggerClassName,
  onValueChange,
  "aria-label": ariaLabel,
}: SelectFieldProps) {
  const field = useFieldContext<string | null>();
  const labelId = `${React.useId()}-label`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? <Label id={labelId}>{label}</Label> : null}
      <Select
        items={items as Array<{ value: string; label: React.ReactNode }>}
        value={field.state.value ?? null}
        onValueChange={(value) => {
          const next = (value as string | null) ?? null;
          field.handleChange(next);
          onValueChange?.(next);
        }}
        onOpenChange={(open) => {
          if (!open) field.handleBlur();
        }}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn("w-full", triggerClassName)}
          aria-labelledby={label ? labelId : undefined}
          aria-label={ariaLabel}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError />
    </div>
  );
}

/** Bordered title/hint row with a trailing switch — the app's dominant toggle. */
function SwitchField({
  label,
  hint,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  const field = useFieldContext<boolean>();
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border p-3",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
      />
    </div>
  );
}

/**
 * Submit button that disables only while submitting (matching the app's old
 * `pending` behavior). We validate on submit, so gating on `canSubmit` would
 * deadlock the button after a failed submit — errors would linger with no
 * onChange validator to clear them. Re-clicking re-runs validation instead.
 */
function SubmitButton({
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button>) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" disabled={disabled || isSubmitting} {...props}>
          {isSubmitting ? <Spinner /> : null}
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    SelectField,
    SwitchField,
  },
  formComponents: {
    SubmitButton,
  },
});
