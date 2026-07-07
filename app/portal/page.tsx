"use client";

import { useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

export default function PortalHome() {
  const { sessionToken, ready } = useStudentSession();
  const me = useQuery(
    api.studentAuth.me,
    ready && sessionToken ? { sessionToken } : "skip",
  );
  const name = me?.student
    ? `${me.student.firstName} ${me.student.lastName}`
    : "";

  return (
    <div className="mx-auto w-full max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="heading-rule text-lg">
            {name ? t("portal.greeting", { name }) : t("auth.welcome")} 👋
          </CardTitle>
          <CardDescription>{t("portal.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sparkles />
              </EmptyMedia>
              <EmptyTitle>{t("portal.soonTitle")}</EmptyTitle>
              <EmptyDescription>{t("portal.soonBody")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
