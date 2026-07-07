"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { AudioPlayer } from "@/components/audio-player";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * M8 — MediaRecorder voice-note input (teacher grading screen). Records
 * audio/webm (browser fallback where unsupported, e.g. Safari → mp4) with a
 * hard 5-minute cap and a live countdown. The parent owns the recorded Blob
 * via value/onChange; re-record replaces it, remove clears it.
 */

const MAX_RECORDING_MS = 5 * 60_000;
const TICK_MS = 250;

/** m:ss countdown (Latin digits). */
function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function VoiceRecorder({
  value,
  onChange,
  disabled,
}: {
  value: Blob | null;
  onChange: (blob: Blob | null) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [remainingMs, setRemainingMs] = useState(MAX_RECORDING_MS);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  /** Swap the preview object URL, revoking the previous one. */
  function setPreview(url: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }

  function clearTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // Unmount cleanup of external resources: mic stream, timer, object URL.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function startRecording() {
    if (recording) return;
    setError(null);
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError(t("exams.recUnsupported"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t("exams.recPermissionDenied"));
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : undefined;
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      recorderRef.current = null;
      setRecording(false);
      onChange(blob);
      setPreview(URL.createObjectURL(blob));
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setRemainingMs(MAX_RECORDING_MS);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const left = MAX_RECORDING_MS - (Date.now() - startedAt);
      setRemainingMs(left);
      if (left <= 0) stopRecording();
    }, TICK_MS);
  }

  function stopRecording() {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function removeRecording() {
    setPreview(null);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {recording ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={stopRecording}
          >
            <Square />
            {t("exams.recStop")}
          </Button>
          <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
            <span
              className="size-2 animate-pulse rounded-full bg-destructive"
              aria-hidden
            />
            {t("exams.recRemainingLabel", { time: formatClock(remainingMs) })}
          </span>
        </div>
      ) : value !== null && previewUrl !== null ? (
        <div className="flex flex-col gap-2">
          <AudioPlayer src={previewUrl} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={startRecording}
            >
              <Mic />
              {t("exams.recRedo")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={removeRecording}
            >
              <X />
              {t("exams.recRemove")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={startRecording}
          >
            <Mic />
            {t("exams.recStart")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("exams.recMaxNote")}
          </span>
        </div>
      )}
      {error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
