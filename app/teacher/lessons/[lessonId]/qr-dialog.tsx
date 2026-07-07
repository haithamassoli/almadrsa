"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import QRCode from "qrcode";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/**
 * Projects a scannable QR encoding a short-lived signed check-in token for one
 * lesson. The dialog issues a fresh token once per open (conditional mount of
 * QrCanvas), builds the portal check-in URL and paints it into a canvas.
 */
export function QrDialog({
  open,
  onOpenChange,
  lessonId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lessonId: Id<"lessons">;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("checkin.qrTitle")}</DialogTitle>
          <DialogDescription>{t("checkin.qrHint")}</DialogDescription>
        </DialogHeader>
        {/* Conditional mount: each open mints exactly one fresh token. */}
        {open ? <QrCanvas lessonId={lessonId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const QR_SIZE = 280;

function QrCanvas({ lessonId }: { lessonId: Id<"lessons"> }) {
  const issueToken = useMutation(api.checkin.issueToken);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Issue the token once when the dialog opens.
  useEffect(() => {
    let cancelled = false;
    issueToken({ lessonId })
      .then((token) => {
        if (!cancelled) setPayload(token);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [issueToken, lessonId]);

  // Paint the QR once the canvas has committed with the token in hand. Colors
  // stay #000/#fff for scan reliability regardless of theme.
  useEffect(() => {
    if (payload === null || canvasRef.current === null) return;
    const url = `${window.location.origin}/portal/checkin?t=${encodeURIComponent(
      payload,
    )}`;
    QRCode.toCanvas(canvasRef.current, url, {
      width: QR_SIZE,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => setFailed(true));
  }, [payload]);

  if (failed) {
    return (
      <p className="py-8 text-center text-sm text-destructive">
        {t("checkin.qrError")}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {payload === null ? (
        <Skeleton
          className="rounded-xl"
          style={{ width: QR_SIZE, height: QR_SIZE }}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="rounded-xl"
          aria-label={t("checkin.qrTitle")}
        />
      )}
      <p className="text-xs text-muted-foreground">{t("checkin.qrExpiry")}</p>
    </div>
  );
}
