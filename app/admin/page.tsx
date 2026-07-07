"use client";

import { useQuery } from "convex/react";
import { LayoutDashboard } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

// Greeting + a tasteful empty placeholder — no fabricated stats. Real
// dashboard content arrives with the M2+ data features.
export default function AdminDashboard() {
  const user = useQuery(api.staff.currentUser);
  return (
    <div className="flex flex-1 flex-col gap-6">
      {user === undefined ? (
        <Skeleton className="h-9 w-56" />
      ) : (
        <h1 className="heading-rule text-2xl font-black">
          {t("nav.greeting", { name: user?.name ?? "" })}
        </h1>
      )}
      <Empty className="flex-1 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboard />
          </EmptyMedia>
          <EmptyTitle>{t("nav.adminHomeTitle")}</EmptyTitle>
          <EmptyDescription>{t("nav.adminHomeBody")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
