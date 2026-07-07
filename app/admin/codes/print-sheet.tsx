"use client";

import { Printer, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export type CodeTicket = {
  studentId: string;
  firstName: string;
  lastName: string;
  code: string;
};

/**
 * Full-screen printable sheet of access-code tickets. The plaintext codes
 * live ONLY in the parent's client state — closing the sheet (or navigating
 * away) discards them forever, so the sheet says so and offers print.
 *
 * Printing: everything outside `.print-sheet-root` is hidden via the
 * visibility trick, and the fixed overlay becomes a normal flowing block so
 * tickets paginate across pages.
 */
export function PrintSheet({
  className,
  tickets,
  onClose,
}: {
  className: string;
  tickets: CodeTicket[];
  onClose: () => void;
}) {
  return (
    <div className="print-sheet-root fixed inset-0 z-[60] overflow-y-auto bg-background p-4 md:p-8">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-sheet-root, .print-sheet-root * { visibility: visible; }
          .print-sheet-root {
            position: absolute !important;
            inset-block-start: 0 !important;
            inset-inline-start: 0 !important;
            inline-size: 100% !important;
            block-size: auto !important;
            overflow: visible !important;
            padding: 0 !important;
            background: white !important;
          }
          .code-ticket { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-col gap-1">
            <h1 className="heading-rule text-2xl font-black">
              {t("codes.printSheetTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("codes.printSheetClass", { name: className })} ·{" "}
              {t("codes.ticketsCount", { count: tickets.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => window.print()}>
              <Printer aria-hidden />
              {t("common.print")}
            </Button>
            <Button variant="outline" onClick={onClose}>
              <X aria-hidden />
              {t("codes.closeSheet")}
            </Button>
          </div>
        </div>

        <Alert variant="destructive" className="print:hidden">
          <AlertDescription>{t("codes.printSheetWarning")}</AlertDescription>
        </Alert>

        {/* Print-only header so the paper copy is self-describing. */}
        <div className="hidden print:block">
          <p className="text-lg font-black">
            {t("common.appName")} — {t("codes.printSheetTitle")}
          </p>
          <p className="text-sm">
            {t("codes.printSheetClass", { name: className })}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
          {tickets.map((ticket) => (
            <div
              key={ticket.studentId}
              className="code-ticket flex break-inside-avoid flex-col gap-2"
            >
              <span className="text-xs font-bold text-muted-foreground">
                {t("common.appName")}
              </span>
              <span className="text-base font-bold">
                {ticket.firstName} {ticket.lastName}
              </span>
              <div
                dir="ltr"
                className="rounded-lg bg-muted px-2 py-3 text-center font-mono text-base font-bold tracking-wide"
              >
                {ticket.code}
              </div>
              <span className="text-xs text-muted-foreground">
                {t("codes.ticketInstruction")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
