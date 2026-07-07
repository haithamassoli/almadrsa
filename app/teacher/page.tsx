import { Clock } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { t } from "@/lib/i18n";

export default function TeacherHome() {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Clock />
        </EmptyMedia>
        <EmptyTitle>{t("nav.comingSoon")}</EmptyTitle>
        <EmptyDescription>{t("nav.teacherHomeBody")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
