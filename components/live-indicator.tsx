"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Subscribes to a Convex query: the M0 "one live query round-trips" proof.
export function LiveIndicator() {
  const health = useQuery(api.app.health);
  const connected = health?.ok === true;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          connected ? "bg-success" : "animate-pulse bg-muted-foreground/40",
        )}
        aria-hidden
      />
      {connected ? t("common.connectedLive") : t("common.connecting")}
    </span>
  );
}
