"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Copy, UserPlus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n";

type StaffRole = "admin" | "teacher";

/** 12 chars over an unambiguous alphabet; uniform via rejection sampling. */
function generatePassword(): string {
  const alphabet =
    "ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz23456789!@#$%^*";
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < 12) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < 12) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

/** Convex wraps thrown errors; pull the human part for the toast. */
function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const match = raw.match(/Uncaught Error:\s*([^\n]+)/);
  return match?.[1]?.trim() || t("common.errorGeneric");
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("staff.passwordCopied"));
  } catch {
    toast.error(t("staff.copyFailed"));
  }
}

const EMPTY_FORM = {
  name: "",
  email: "",
  password: "",
  role: "teacher" as string | null,
};

export default function StaffPage() {
  const users = useQuery(api.staff.listStaff);
  const me = useQuery(api.staff.currentUser);
  const createAccount = useAction(api.staff.createStaffAccount);
  const setStaffBanned = useAction(api.staff.setStaffBanned);

  const [addOpen, setAddOpen] = useState(false);
  const [pendingBan, setPendingBan] = useState<{
    userId: string;
    name: string;
    banned: boolean;
  } | null>(null);
  const [banBusy, setBanBusy] = useState(false);

  const roleItems = [
    { value: "teacher", label: t("auth.roleTeacher") },
    { value: "admin", label: t("auth.roleAdmin") },
  ];

  const form = useAppForm({
    defaultValues: EMPTY_FORM,
    validators: {
      // Same gates the old canSubmit enforced: name present, email > 3 chars,
      // password >= 8. Empty email reads as required, 1–3 chars as invalid.
      onSubmit: z.object({
        name: z.string().trim().min(1, t("common.requiredField")),
        email: z
          .string()
          .trim()
          .min(1, t("common.requiredField"))
          .min(4, t("common.invalidValue")),
        password: z.string().min(8, t("common.invalidValue")),
        role: z.string().nullable(),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        await createAccount({
          name: value.name.trim(),
          email: value.email.trim(),
          password: value.password,
          role: (value.role ?? "teacher") as StaffRole,
        });
        toast.success(t("staff.createdToast"));
        setAddOpen(false);
        form.reset(EMPTY_FORM);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
  });

  async function confirmBan() {
    if (!pendingBan || banBusy) return;
    setBanBusy(true);
    try {
      await setStaffBanned({
        userId: pendingBan.userId,
        banned: pendingBan.banned,
      });
      toast.success(
        pendingBan.banned ? t("staff.bannedToast") : t("staff.unbannedToast"),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBanBusy(false);
      setPendingBan(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="heading-rule text-2xl font-black">
            {t("staff.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("staff.subtitle")}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus aria-hidden />
          {t("staff.addMember")}
        </Button>
      </div>

      {users === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : users.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("staff.emptyList")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("staff.colName")}</TableHead>
                <TableHead>{t("staff.colEmail")}</TableHead>
                <TableHead>{t("staff.colRole")}</TableHead>
                <TableHead>{t("staff.colStatus")}</TableHead>
                <TableHead className="text-end">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const isSelf = me?.id === user.id;
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.name}
                      {isSelf && (
                        <Badge variant="secondary" className="ms-2">
                          {t("staff.you")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-mono text-xs">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.role === "admin" ? "default" : "secondary"
                        }
                      >
                        {user.role === "admin"
                          ? t("auth.roleAdmin")
                          : t("auth.roleTeacher")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.banned ? (
                        <Badge variant="destructive">
                          {t("staff.statusBanned")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          {t("staff.statusActive")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {!isSelf && (
                        <Button
                          variant={user.banned ? "outline" : "destructive"}
                          size="sm"
                          disabled={banBusy}
                          onClick={() =>
                            setPendingBan({
                              userId: user.id,
                              name: user.name,
                              banned: !user.banned,
                            })
                          }
                        >
                          {user.banned ? t("staff.unban") : t("staff.ban")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create account dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) form.reset(EMPTY_FORM);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("staff.createTitle")}</DialogTitle>
            <DialogDescription>{t("staff.createDesc")}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label={t("staff.nameLabel")}
                  placeholder={t("staff.namePlaceholder")}
                  autoComplete="off"
                />
              )}
            </form.AppField>
            <form.AppField name="email">
              {(field) => (
                <field.TextField
                  label={t("staff.emailLabel")}
                  type="email"
                  dir="ltr"
                  placeholder={t("staff.emailPlaceholder")}
                  autoComplete="off"
                />
              )}
            </form.AppField>
            {/* Custom layout (generate/copy buttons + hint) — bound to the
                field directly since it isn't a plain TextField. */}
            <form.AppField name="password">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={field.name}>
                    {t("staff.passwordLabel")}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={field.name}
                      name={field.name}
                      dir="ltr"
                      className="font-mono"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder={t("staff.passwordPlaceholder")}
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("staff.generatePassword")}
                      onClick={() => field.handleChange(generatePassword())}
                    >
                      <Wand2 aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("staff.copyPassword")}
                      disabled={field.state.value.length === 0}
                      onClick={() => void copyToClipboard(field.state.value)}
                    >
                      <Copy aria-hidden />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("staff.passwordShownOnce")}
                  </p>
                </div>
              )}
            </form.AppField>
            <form.AppField name="role">
              {(field) => (
                <field.SelectField
                  label={t("staff.roleLabel")}
                  items={roleItems}
                />
              )}
            </form.AppField>
            <DialogFooter>
              <form.Subscribe selector={(s) => s.isSubmitting}>
                {(isSubmitting) => (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => setAddOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                )}
              </form.Subscribe>
              <form.AppForm>
                <form.SubmitButton>{t("staff.create")}</form.SubmitButton>
              </form.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ban / unban confirm */}
      <AlertDialog
        open={pendingBan !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBan(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingBan?.banned
                ? t("staff.confirmBanTitle")
                : t("staff.confirmUnbanTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBan?.banned
                ? t("staff.confirmBanDesc", { name: pendingBan?.name ?? "" })
                : t("staff.confirmUnbanDesc", {
                    name: pendingBan?.name ?? "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={banBusy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={pendingBan?.banned ? "destructive" : "default"}
              disabled={banBusy}
              onClick={() => void confirmBan()}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
