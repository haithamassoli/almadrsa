"use client";

import { cn } from "@/lib/utils";

/**
 * M8 — thin wrapper around the native audio element. Playback chrome is
 * timeline-shaped (elapsed → remaining), so it stays LTR even inside the
 * app's RTL layout.
 */
export function AudioPlayer({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <audio
      controls
      preload="metadata"
      src={src}
      dir="ltr"
      className={cn("h-10 w-full max-w-sm rounded-full", className)}
    />
  );
}
