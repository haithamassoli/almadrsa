"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/lib/i18n";
import { AssignmentsTab } from "./assignments-tab";
import { ClassesTab } from "./classes-tab";
import { GradesTab } from "./grades-tab";
import { SubjectsTab } from "./subjects-tab";
import { TermsTab } from "./terms-tab";

export default function StructurePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="heading-rule text-2xl font-black">
          {t("structure.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("structure.description")}
        </p>
      </div>

      <Tabs defaultValue="grades">
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="grades">{t("structure.tabGrades")}</TabsTrigger>
            <TabsTrigger value="subjects">
              {t("structure.tabSubjects")}
            </TabsTrigger>
            <TabsTrigger value="classes">
              {t("structure.tabClasses")}
            </TabsTrigger>
            <TabsTrigger value="terms">{t("structure.tabTerms")}</TabsTrigger>
            <TabsTrigger value="assignments">
              {t("structure.tabAssignments")}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="grades">
          <GradesTab />
        </TabsContent>
        <TabsContent value="subjects">
          <SubjectsTab />
        </TabsContent>
        <TabsContent value="classes">
          <ClassesTab />
        </TabsContent>
        <TabsContent value="terms">
          <TermsTab />
        </TabsContent>
        <TabsContent value="assignments">
          <AssignmentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
