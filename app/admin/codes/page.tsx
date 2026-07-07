"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, KeyRound, Printer } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, t } from "@/lib/i18n";
import { PrintSheet, type CodeTicket } from "./print-sheet";

type PendingAction =
  | { type: "issue"; studentId: Id<"students">; name: string }
  | { type: "revoke"; studentId: Id<"students">; name: string }
  | { type: "issueAll" };

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("codes.copied"));
  } catch {
    toast.error(t("codes.copyFailed"));
  }
}

export default function CodesPage() {
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeDialog, setCodeDialog] = useState<{
    name: string;
    code: string;
  } | null>(null);
  const [sheet, setSheet] = useState<{
    className: string;
    tickets: CodeTicket[];
  } | null>(null);

  const classes = useQuery(api.academics.listAllClasses, {});
  const roster = useQuery(
    api.codes.listClassCodeStatus,
    classId ? { classId } : "skip",
  );
  const issueCode = useMutation(api.codes.issueCode);
  const revokeCode = useMutation(api.codes.revokeCode);
  const issueCodesForClass = useMutation(api.codes.issueCodesForClass);

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({ value: c._id as string, label: c.name })),
    [classes],
  );
  const selectedClassName =
    classes?.find((c) => c._id === classId)?.name ?? "";

  async function runBulk(onlyMissing: boolean) {
    if (!classId) return;
    setBusy(true);
    try {
      const tickets = await issueCodesForClass({ classId, onlyMissing });
      if (tickets.length === 0) {
        toast.info(t("codes.bulkNoneNeeded"));
      } else {
        toast.success(
          t("codes.bulkIssuedToast", { count: tickets.length }),
        );
        setSheet({ className: selectedClassName, tickets });
      }
    } catch {
      toast.error(t("common.errorGeneric"));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  async function confirmPending() {
    if (!pending || busy) return;
    if (pending.type === "issueAll") {
      await runBulk(false);
      return;
    }
    setBusy(true);
    try {
      if (pending.type === "issue") {
        const { code } = await issueCode({ studentId: pending.studentId });
        toast.success(t("codes.issuedToast"));
        setCodeDialog({ name: pending.name, code });
      } else {
        await revokeCode({ studentId: pending.studentId });
        toast.success(t("codes.revokedToast"));
      }
    } catch {
      toast.error(t("common.errorGeneric"));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const pendingTitle =
    pending?.type === "issue"
      ? t("codes.confirmIssueTitle")
      : pending?.type === "revoke"
        ? t("codes.confirmRevokeTitle")
        : t("codes.confirmIssueAllTitle");
  const pendingDesc =
    pending?.type === "issue"
      ? t("codes.confirmIssueDesc", { name: pending.name })
      : pending?.type === "revoke"
        ? t("codes.confirmRevokeDesc", { name: pending.name })
        : t("codes.confirmIssueAllDesc");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="heading-rule text-2xl font-black">
          {t("codes.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("codes.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            {t("codes.selectClassLabel")}
          </span>
          <Select
            items={classItems}
            value={classId}
            onValueChange={(value) =>
              setClassId((value as Id<"classes">) ?? null)
            }
          >
            <SelectTrigger className="w-64 max-w-full">
              <SelectValue placeholder={t("codes.selectClassPlaceholder")} />
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!classId || busy}
            onClick={() => void runBulk(true)}
          >
            <KeyRound aria-hidden />
            {t("codes.issueMissing")}
          </Button>
          <Button
            disabled={!classId || busy}
            onClick={() => setPending({ type: "issueAll" })}
          >
            <Printer aria-hidden />
            {t("codes.issueAll")}
          </Button>
        </div>
      </div>

      {!classId ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("codes.pickClassFirst")}
        </p>
      ) : roster === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : roster.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("codes.emptyClass")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("codes.colStudent")}</TableHead>
                <TableHead>{t("codes.colCodeStatus")}</TableHead>
                <TableHead>{t("codes.colIssuedAt")}</TableHead>
                <TableHead>{t("codes.colLastLogin")}</TableHead>
                <TableHead className="text-end">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.map((row) => {
                const name = `${row.firstName} ${row.lastName}`;
                return (
                  <TableRow key={row.studentId}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell>
                      {row.hasActiveCode ? (
                        <Badge>{t("codes.statusActive")}</Badge>
                      ) : (
                        <Badge variant="outline">
                          {t("codes.statusNone")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.createdAt !== undefined
                        ? formatDate(row.createdAt)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lastLoginAt !== undefined
                        ? formatDateTime(row.lastLoginAt)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setPending({
                              type: "issue",
                              studentId: row.studentId,
                              name,
                            })
                          }
                        >
                          {row.hasActiveCode
                            ? t("codes.reissue")
                            : t("codes.issue")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy || !row.hasActiveCode}
                          onClick={() =>
                            setPending({
                              type: "revoke",
                              studentId: row.studentId,
                              name,
                            })
                          }
                        >
                          {t("codes.revoke")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Confirm dialog (issue / revoke / issue-all) */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingTitle}</AlertDialogTitle>
            <AlertDialogDescription>{pendingDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void confirmPending()}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One-time plaintext code dialog */}
      <Dialog
        open={codeDialog !== null}
        onOpenChange={(open) => {
          if (!open) setCodeDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("codes.codeDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("codes.codeDialogShownOnce")}
            </DialogDescription>
          </DialogHeader>
          {codeDialog && (
            <div className="code-ticket flex flex-col gap-2">
              <span className="text-xs font-bold text-muted-foreground">
                {t("common.appName")}
              </span>
              <span className="text-base font-bold">{codeDialog.name}</span>
              <div
                dir="ltr"
                className="rounded-lg bg-muted px-2 py-3 text-center font-mono text-base font-bold tracking-wide"
              >
                {codeDialog.code}
              </div>
              <span className="text-xs text-muted-foreground">
                {t("codes.ticketInstruction")}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => codeDialog && void copyToClipboard(codeDialog.code)}
          >
            <Copy aria-hidden />
            {t("codes.copy")}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Bulk result: full-screen printable sheet */}
      {sheet && (
        <PrintSheet
          className={sheet.className}
          tickets={sheet.tickets}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
