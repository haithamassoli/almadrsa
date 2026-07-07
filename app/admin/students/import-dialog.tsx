"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n";
import { parseStudentsCsv, type CsvStudentRow } from "./csv";
import { errorText, mutationErrorText } from "./errors";

const PREVIEW_LIMIT = 10;

type ImportResult = {
  imported: number;
  failed: number;
  results: Array<{ row: number; ok: boolean; error?: string }>;
};

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const bulkImport = useMutation(api.students.bulkImport);
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<CsvStudentRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setRows(null);
    setParseError(null);
    setPending(false);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setRows(null);
    setParseError(null);
    setResult(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseStudentsCsv(text);
      if (!parsed.ok) {
        setParseError(
          parsed.error === "missing_header"
            ? t("students.missingHeader")
            : t("students.fileEmpty"),
        );
        return;
      }
      setRows(parsed.rows);
    } catch {
      setParseError(t("students.fileReadError"));
    }
  }

  async function onImport() {
    if (!rows || rows.length === 0) return;
    setPending(true);
    try {
      const res = await bulkImport({ rows });
      setResult(res);
      toast.success(
        t("students.importSummary", { ok: res.imported, fail: res.failed }),
      );
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  const failedRows = result?.results.filter((r) => !r.ok) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("students.importTitle")}</DialogTitle>
          <DialogDescription>{t("students.importHint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            aria-label={t("students.chooseFile")}
            onChange={onFileChange}
          />

          {parseError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>{parseError}</AlertTitle>
            </Alert>
          ) : null}

          {rows && result === null ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {t("students.rowsFound", { count: rows.length })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("students.previewTitle", {
                    count: Math.min(rows.length, PREVIEW_LIMIT),
                  })}
                </p>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>{t("students.firstName")}</TableHead>
                      <TableHead>{t("students.lastName")}</TableHead>
                      <TableHead>{t("students.guardianName")}</TableHead>
                      <TableHead>{t("students.guardianPhone")}</TableHead>
                      <TableHead>{t("students.class")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell>{row.firstName}</TableCell>
                        <TableCell>{row.lastName}</TableCell>
                        <TableCell>{row.guardianName ?? "—"}</TableCell>
                        <TableCell dir="ltr" className="text-end">
                          {row.guardianPhone ?? "—"}
                        </TableCell>
                        <TableCell>{row.className ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-3">
              <Alert>
                <CircleCheck />
                <AlertTitle>
                  {t("students.importSummary", {
                    ok: result.imported,
                    fail: result.failed,
                  })}
                </AlertTitle>
              </Alert>
              {failedRows.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    {t("students.failedRowsTitle")}
                  </p>
                  <ul className="flex max-h-48 flex-col gap-1 overflow-auto rounded-lg border p-2">
                    {failedRows.map((r) => (
                      <li
                        key={r.row}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Badge variant="destructive">
                          {t("students.rowLabel", { row: r.row })}
                        </Badge>
                        <span className="text-muted-foreground">
                          {errorText(r.error)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            {t("common.close")}
          </Button>
          {result === null ? (
            <Button
              type="button"
              disabled={!rows || rows.length === 0 || pending}
              onClick={onImport}
            >
              {pending ? <Spinner /> : null}
              {pending ? t("students.importing") : t("students.import")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
