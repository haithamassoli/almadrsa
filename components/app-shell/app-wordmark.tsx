import { GraduationCap } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The المدرسة wordmark: teal tile + app name. Presentational only — wrap it in
 * a Link where it should navigate. Shared by the staff shell, the auth pages
 * and the student portal header so the brand reads identically everywhere.
 */
export function AppWordmark({
  className,
  size = "default",
}: {
  className?: string;
  size?: "default" | "sm";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-xl bg-primary text-primary-foreground",
          size === "sm" ? "size-8" : "size-9",
        )}
      >
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <span
        className={cn(
          "font-black tracking-tight",
          size === "sm" ? "text-base" : "text-lg",
        )}
      >
        {t("common.appName")}
      </span>
    </span>
  );
}
