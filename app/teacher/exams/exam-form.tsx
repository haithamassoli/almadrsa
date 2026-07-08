"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useStore } from "@tanstack/react-form";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { numberString, useAppForm } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, msToLocalInput, t, type MessageKey } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

export type ExamStatus = "draft" | "published" | "closed";
type QuestionType =
  | "mcq"
  | "truefalse"
  | "fillblank"
  | "matching"
  | "ordering"
  | "essay";
type Difficulty = "easy" | "medium" | "hard";

/** M15 — one sampling rule of a version-ruled exam (api.exams shape). */
type VersionRule = {
  topic?: string; // undefined ⇒ any topic
  difficulty?: Difficulty; // undefined ⇒ any difficulty
  count: number;
  marksEach: number;
};

/** Shape returned by api.exams.get (builder/detail). */
export type ExamDetail = {
  _id: Id<"exams">;
  title: string;
  teacherId: string;
  classId: Id<"classes">;
  subjectId: Id<"subjects">;
  className: string;
  subjectName: string;
  status: ExamStatus;
  windowStart: number;
  windowEnd: number;
  timeLimitMinutes: number;
  totalMarks: number;
  shuffle?: boolean; // undefined ⇒ true
  versionRules?: Array<VersionRule>; // M15 — unique per-student versions
  noBacktrack?: boolean; // M15 — undefined ⇒ false
  questions: Array<{
    questionId: Id<"questions">;
    marks: number;
    type: QuestionType;
    text: string;
    options: Array<{ id: string; text: string }>;
    correctOptionId?: string;
    correctBool?: boolean;
    topic?: string;
    difficulty: Difficulty;
  }>;
};

/** Row shape returned by api.questions.list. */
type BankQuestion = {
  _id: Id<"questions">;
  type: QuestionType;
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  correctBool?: boolean;
  topic?: string;
  difficulty: Difficulty;
  teacherId: string;
};

// ——— Shared status badge (list + detail pages import it from here) ———

const STATUS_BADGE: Record<
  ExamStatus,
  { labelKey: MessageKey; variant: "secondary" | "outline"; className?: string }
> = {
  draft: { labelKey: "exams.statusDraft", variant: "secondary" },
  published: {
    labelKey: "exams.statusPublished",
    variant: "outline",
    className: "border-transparent bg-success/10 text-success",
  },
  closed: { labelKey: "exams.statusClosed", variant: "outline" },
};

export function ExamStatusBadge({ status }: { status: ExamStatus }) {
  const badge = STATUS_BADGE[status];
  return (
    <Badge variant={badge.variant} className={badge.className}>
      {t(badge.labelKey)}
    </Badge>
  );
}

// ——— Question metadata labels ———

const TYPE_LABEL: Record<QuestionType, MessageKey> = {
  mcq: "exams.typeMcq",
  truefalse: "exams.typeTruefalse",
  fillblank: "exams.typeFillblank",
  matching: "exams.typeMatching",
  ordering: "exams.typeOrdering",
  essay: "exams.typeEssay",
};
const DIFFICULTY_LABEL: Record<Difficulty, MessageKey> = {
  easy: "exams.difficultyEasy",
  medium: "exams.difficultyMedium",
  hard: "exams.difficultyHard",
};
const DIFFICULTY_CLASS: Record<Difficulty, string> = {
  easy: "border-transparent bg-success/10 text-success",
  medium: "border-transparent bg-accent text-accent-foreground",
  hard: "border-transparent bg-destructive/10 text-destructive",
};

const ALL = "all";

// ——— M15: version-rule drafts (unique per-student exams) ———

/** One editable rule row; ALL sentinels mean "any topic/difficulty". */
type RuleDraft = {
  key: string; // stable render key, never sent to the server
  topic: string;
  difficulty: string;
  count: string;
  marksEach: string;
};

let ruleKeySeq = 0;
function newRuleDraft(): RuleDraft {
  ruleKeySeq += 1;
  return {
    key: `rule-${ruleKeySeq}`,
    topic: ALL,
    difficulty: ALL,
    count: "5",
    marksEach: "1",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * M15 — a version-ruled exam still stores a fixed `questions` list: the
 * server validates it like any exam (1–100 rows, marks in (0, 100]) and
 * keeps it as the fallback preview — attempts sample their own sets, so it
 * is never what students get. Derive it from the rules so its composition
 * mirrors them: the first matching bank questions per rule, without
 * replacement, at that rule's marks, capped at the server's 100-row limit.
 * The bank list already excludes archived questions (api.questions.list),
 * matching what the server accepts.
 */
function deriveFallbackQuestions(
  bank: Array<BankQuestion>,
  rules: Array<VersionRule>,
): Array<{ questionId: Id<"questions">; marks: number }> {
  const used = new Set<string>();
  const fallback: Array<{ questionId: Id<"questions">; marks: number }> = [];
  for (const rule of rules) {
    let taken = 0;
    for (const question of bank) {
      if (fallback.length >= 100) return fallback;
      if (taken >= rule.count) break;
      if (used.has(question._id)) continue;
      if (rule.topic !== undefined && question.topic !== rule.topic) continue;
      if (
        rule.difficulty !== undefined &&
        question.difficulty !== rule.difficulty
      ) {
        continue;
      }
      used.add(question._id);
      fallback.push({ questionId: question._id, marks: rule.marksEach });
      taken++;
    }
  }
  return fallback;
}

/**
 * Shared create/edit exam builder. Without `exam` it creates a draft
 * (api.exams.create); with it, it pre-fills and saves via api.exams.update.
 * Both paths navigate to the exam detail page on success.
 */
export function ExamForm({ exam }: { exam?: ExamDetail }) {
  const router = useRouter();
  const createExam = useMutation(api.exams.create);
  const updateExam = useMutation(api.exams.update);
  const classes = useQuery(api.lessons.listMyClasses, {});

  // The real submit work lives in submitRef, assigned in an effect below.
  // Defining it inline here would close over the `rules`/`selected` useState,
  // which the React Compiler then treats as mutable across the whole body and
  // can't memoize past. Keeping this closure ref-only avoids that.
  const submitRef = useRef<(() => Promise<void>) | null>(null);

  const form = useAppForm({
    defaultValues: {
      title: exam?.title ?? "",
      classId: (exam?.classId ?? null) as string | null,
      subjectId: (exam?.subjectId ?? null) as string | null,
      startLocal: exam ? msToLocalInput(exam.windowStart) : "",
      endLocal: exam ? msToLocalInput(exam.windowEnd) : "",
      timeLimit: exam ? String(exam.timeLimitMinutes) : "30",
      // M8 — per-student shuffle; default ON (server treats undefined as true).
      shuffle: exam ? exam.shuffle !== false : true,
      // M15 — one-way navigation while taking the exam.
      noBacktrack: exam?.noBacktrack === true,
      // M15 — unique per-student versions sampled from the bank by rules.
      versioned: (exam?.versionRules?.length ?? 0) > 0,
    },
    validators: {
      onSubmit: z.object({
        title: z
          .string()
          .trim()
          .min(1, t("common.requiredField"))
          .max(200, t("common.invalidValue")),
        // class/subject presence + window ordering are cross-cutting and stay
        // as onSubmit toasts (unchanged messages), like the rest of the checks.
        classId: z.string().nullable(),
        subjectId: z.string().nullable(),
        startLocal: z.string().min(1, t("common.requiredField")),
        endLocal: z.string().min(1, t("common.requiredField")),
        timeLimit: numberString({ int: true, min: 1, max: 300 }),
        shuffle: z.boolean(),
        noBacktrack: z.boolean(),
        versioned: z.boolean(),
      }),
    },
    onSubmit: async () => {
      await submitRef.current?.();
    },
  });

  // Reactive reads — these drive the bank query, the derived option lists, and
  // the versioned/manual section toggle, so they must re-render on change.
  const classId = useStore(form.store, (s) => s.values.classId);
  const subjectId = useStore(form.store, (s) => s.values.subjectId);
  const versioned = useStore(form.store, (s) => s.values.versioned);

  // M15 — version-rule drafts and the manual question selection are not scalar
  // form fields (a dynamic array and an id→marks map), so they stay local.
  const [rules, setRules] = useState<Array<RuleDraft>>(() =>
    exam?.versionRules !== undefined && exam.versionRules.length > 0
      ? exam.versionRules.map((rule) => ({
          ...newRuleDraft(),
          topic: rule.topic ?? ALL,
          difficulty: rule.difficulty ?? ALL,
          count: String(rule.count),
          marksEach: String(rule.marksEach),
        }))
      : [newRuleDraft()],
  );
  // questionId → marks (kept as input string); insertion order = exam order.
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (exam?.questions ?? []).map((q) => [q.questionId, String(q.marks)]),
    ),
  );

  // Quick filters over the bank list.
  const [topicFilter, setTopicFilter] = useState(ALL);
  const [difficultyFilter, setDifficultyFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);

  const questions = useQuery(
    api.questions.list,
    subjectId ? { subjectId: subjectId as Id<"subjects"> } : "skip",
  );

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );
  const subjectItems = useMemo(() => {
    const cls = (classes ?? []).find((c) => c.classId === classId);
    return (cls?.subjects ?? []).map((s) => ({
      value: s.subjectId as string,
      label: s.name,
    }));
  }, [classes, classId]);

  const bankTopics = useMemo(() => {
    const topics = new Set<string>();
    for (const question of questions ?? []) {
      if (question.topic) topics.add(question.topic);
    }
    return [...topics];
  }, [questions]);
  const topicItems = useMemo(
    () => [
      { value: ALL, label: t("exams.allTopics") },
      ...bankTopics.map((topic) => ({ value: topic, label: topic })),
    ],
    [bankTopics],
  );
  // M15 — rule topic items: the bank's topics plus any stored rule topic no
  // longer present (so an edited draft never renders a blank Select).
  const ruleTopicItems = useMemo(() => {
    const topics = new Set(bankTopics);
    for (const rule of rules) {
      if (rule.topic !== ALL) topics.add(rule.topic);
    }
    return [
      { value: ALL, label: t("exams.anyTopic") },
      ...[...topics].map((topic) => ({ value: topic, label: topic })),
    ];
  }, [bankTopics, rules]);
  const ruleDifficultyItems = useMemo(
    () => [
      { value: ALL, label: t("exams.anyDifficulty") },
      { value: "easy", label: t("exams.difficultyEasy") },
      { value: "medium", label: t("exams.difficultyMedium") },
      { value: "hard", label: t("exams.difficultyHard") },
    ],
    [],
  );
  const difficultyItems = useMemo(
    () => [
      { value: ALL, label: t("exams.allDifficulties") },
      { value: "easy", label: t("exams.difficultyEasy") },
      { value: "medium", label: t("exams.difficultyMedium") },
      { value: "hard", label: t("exams.difficultyHard") },
    ],
    [],
  );
  const typeItems = useMemo(
    () => [
      { value: ALL, label: t("exams.allTypes") },
      { value: "mcq", label: t("exams.typeMcq") },
      { value: "truefalse", label: t("exams.typeTruefalse") },
      { value: "fillblank", label: t("exams.typeFillblank") },
      { value: "matching", label: t("exams.typeMatching") },
      { value: "ordering", label: t("exams.typeOrdering") },
      { value: "essay", label: t("exams.typeEssay") },
    ],
    [],
  );

  const filtered = (questions ?? []).filter(
    (question) =>
      (topicFilter === ALL || question.topic === topicFilter) &&
      (difficultyFilter === ALL || question.difficulty === difficultyFilter) &&
      (typeFilter === ALL || question.type === typeFilter),
  );

  // Selection restricted to ids present in the live bank (guards against
  // questions archived since a draft was saved — the server rejects those).
  const validSelected = useMemo(() => {
    const entries = Object.entries(selected);
    if (questions === undefined) return entries;
    const known = new Set<string>(questions.map((question) => question._id));
    return entries.filter(([id]) => known.has(id));
  }, [selected, questions]);
  const selectedCount = validSelected.length;
  const selectedTotal = validSelected.reduce(
    (sum, [, marks]) => sum + (Number(marks) || 0),
    0,
  );
  // M15 — versioned total: Σ count×marksEach over the rule drafts, matching
  // the server's totalMarks for version-ruled exams.
  const rulesTotal = round2(
    rules.reduce(
      (sum, rule) =>
        sum + (Number(rule.count) || 0) * (Number(rule.marksEach) || 0),
      0,
    ),
  );

  // Real submit logic, kept out of the form config so it doesn't capture the
  // rules/selected useState in render phase (see submitRef). The effect re-runs
  // each render so the ref always holds the latest closure; a submit only fires
  // after a committed render, so it reads current values.
  useEffect(() => {
    submitRef.current = async () => {
      const value = form.state.values;
      if (!value.classId || !value.subjectId) {
        toast.error(t("exams.errMissingClassSubject"));
        return;
      }
      const windowStart = new Date(value.startLocal).getTime();
      const windowEnd = new Date(value.endLocal).getTime();
      if (
        !Number.isFinite(windowStart) ||
        !Number.isFinite(windowEnd) ||
        windowStart >= windowEnd
      ) {
        toast.error(t("exams.errWindowOrder"));
        return;
      }
      let questionsPayload: Array<{
        questionId: Id<"questions">;
        marks: number;
      }>;
      let versionRulesPayload: Array<VersionRule> = [];
      if (value.versioned) {
        // M15 — version-ruled exam: the rules replace the manual selection.
        versionRulesPayload = rules.map((rule) => ({
          topic: rule.topic === ALL ? undefined : rule.topic,
          difficulty:
            rule.difficulty === ALL
              ? undefined
              : (rule.difficulty as Difficulty),
          count: Number(rule.count),
          marksEach: Number(rule.marksEach),
        }));
        if (
          versionRulesPayload.some(
            (rule) =>
              !Number.isInteger(rule.count) ||
              rule.count < 1 ||
              rule.count > 50 ||
              !(rule.marksEach > 0) ||
              rule.marksEach > 100,
          )
        ) {
          toast.error(t("exams.errRuleValues"));
          return;
        }
        questionsPayload = deriveFallbackQuestions(
          questions ?? [],
          versionRulesPayload,
        );
        // The server requires ≥1 fallback question even for versioned exams —
        // an empty bank (or none matching any rule) cannot be saved.
        if (questionsPayload.length === 0) {
          toast.error(t("exams.errInsufficientBank"));
          return;
        }
      } else {
        if (selectedCount === 0) {
          toast.error(t("exams.errNoQuestionsSelected"));
          return;
        }
        questionsPayload = validSelected.map(([id, marks]) => ({
          questionId: id as Id<"questions">,
          marks: Number(marks),
        }));
        // Filtered-out rows unmount their inputs, so native min/max validation
        // cannot cover every selected question — recheck the whole selection.
        if (questionsPayload.some((q) => !(q.marks > 0) || q.marks > 100)) {
          toast.error(t("exams.errMarksRange"));
          return;
        }
      }

      const payload = {
        title: value.title.trim(),
        classId: value.classId as Id<"classes">,
        subjectId: value.subjectId as Id<"subjects">,
        questions: questionsPayload,
        windowStart,
        windowEnd,
        timeLimitMinutes: Number(value.timeLimit),
        shuffle: value.shuffle,
        noBacktrack: value.noBacktrack,
        // [] clears on update and normalizes to "no rules" on create.
        versionRules: versionRulesPayload,
      };
      try {
        if (exam) {
          await updateExam({ examId: exam._id, ...payload });
          toast.success(t("exams.updated"));
          router.push(`/teacher/exams/${exam._id}`);
        } else {
          const examId = await createExam(payload);
          toast.success(t("exams.createdDraft"));
          router.push(`/teacher/exams/${examId}`);
        }
        // Keep the submit button disabled through the client navigation that
        // unmounts this form (mirrors the old "pending stays true").
        await new Promise<void>(() => {});
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    };
  });

  // SelectField applies the new classId before these run; `subjectId`/`classId`
  // here are the pre-change values (this render's closure).
  function onClassChange(value: string | null) {
    const next = (classes ?? []).find((c) => c.classId === value);
    // Same-grade classes share subjects; otherwise the subject (and with it
    // the whole question selection) no longer applies.
    if (!next?.subjects.some((s) => s.subjectId === subjectId)) {
      form.setFieldValue("subjectId", null);
      setSelected({});
      setTopicFilter(ALL);
      resetRuleTopics();
    }
  }

  function onSubjectChange(value: string | null) {
    if (value === subjectId) return;
    setSelected({});
    setTopicFilter(ALL);
    resetRuleTopics();
  }

  // M15 — rule topics belong to the previous subject's bank; keep the rest.
  function resetRuleTopics() {
    setRules((prev) => prev.map((rule) => ({ ...rule, topic: ALL })));
  }

  function updateRule(key: string, patch: Partial<RuleDraft>) {
    setRules((prev) =>
      prev.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)),
    );
  }

  function addRule() {
    setRules((prev) =>
      prev.length >= 10 ? prev : [...prev, newRuleDraft()],
    );
  }

  function removeRule(key: string) {
    setRules((prev) =>
      prev.length <= 1 ? prev : prev.filter((rule) => rule.key !== key),
    );
  }

  function toggleQuestion(id: string, checked: boolean) {
    setSelected((prev) => {
      if (checked) return { ...prev, [id]: prev[id] ?? "1" };
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function setMarks(id: string, value: string) {
    setSelected((prev) => ({ ...prev, [id]: value }));
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-1 flex-col gap-6"
    >
      {/* Exam settings */}
      <div className="grid gap-4 md:grid-cols-2">
        <form.AppField name="title">
          {(field) => (
            <field.TextField
              label={t("exams.fieldTitle")}
              maxLength={200}
              className="md:col-span-2"
            />
          )}
        </form.AppField>

        <form.AppField name="classId">
          {(field) => (
            <field.SelectField
              label={t("exams.fieldClass")}
              placeholder={t("exams.selectClass")}
              items={classItems}
              disabled={classes === undefined}
              onValueChange={onClassChange}
            />
          )}
        </form.AppField>

        <form.AppField name="subjectId">
          {(field) => (
            <field.SelectField
              label={t("exams.fieldSubject")}
              placeholder={t("exams.selectSubject")}
              items={subjectItems}
              disabled={classId === null}
              onValueChange={onSubjectChange}
            />
          )}
        </form.AppField>

        <form.AppField name="startLocal">
          {(field) => (
            <field.TextField
              label={t("exams.fieldWindowStart")}
              type="datetime-local"
              dir="ltr"
            />
          )}
        </form.AppField>
        {/* End's picker min tracks the live start value. */}
        <form.Subscribe selector={(s) => s.values.startLocal}>
          {(startLocal) => (
            <form.AppField name="endLocal">
              {(field) => (
                <field.TextField
                  label={t("exams.fieldWindowEnd")}
                  type="datetime-local"
                  dir="ltr"
                  min={startLocal || undefined}
                />
              )}
            </form.AppField>
          )}
        </form.Subscribe>

        <form.AppField name="timeLimit">
          {(field) => (
            <field.TextField
              label={t("exams.fieldTimeLimit")}
              type="number"
              dir="ltr"
              inputMode="numeric"
              min={1}
              max={300}
              step={1}
            />
          )}
        </form.AppField>

        {/* M8 — per-student question/option shuffle */}
        <form.AppField name="shuffle">
          {(field) => (
            <field.SwitchField
              label={t("exams.fieldShuffle")}
              hint={t("exams.shuffleHint")}
              className="md:col-span-2"
            />
          )}
        </form.AppField>
      </div>

      {/* M15 — security & integrity */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold">{t("exams.securityTitle")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <form.AppField name="noBacktrack">
            {(field) => (
              <field.SwitchField
                label={t("exams.fieldNoBacktrack")}
                hint={t("exams.noBacktrackHint")}
              />
            )}
          </form.AppField>
          <form.AppField name="versioned">
            {(field) => (
              <field.SwitchField
                label={t("exams.fieldVersioned")}
                hint={t("exams.versionedHint")}
              />
            )}
          </form.AppField>
        </div>
      </section>

      {versioned ? (
        /* M15 — version rules replace the manual question picker */
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-bold">{t("exams.rulesTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("exams.rulesHint")}
            </p>
          </div>

          {!subjectId ? (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {t("exams.pickSubjectFirst")}
            </p>
          ) : questions === undefined ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : questions.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {t("exams.bankEmpty")}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {rules.map((rule, index) => (
                  <RuleRow
                    key={rule.key}
                    rule={rule}
                    index={index}
                    topicItems={ruleTopicItems}
                    difficultyItems={ruleDifficultyItems}
                    removable={rules.length > 1}
                    onChange={updateRule}
                    onRemove={removeRule}
                  />
                ))}
              </ul>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRule}
                  disabled={rules.length >= 10}
                >
                  <Plus />
                  {t("exams.addRule")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : (
        /* Question picker */
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-bold">{t("exams.pickerTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("exams.pickerHint")}
            </p>
          </div>

          {!subjectId ? (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {t("exams.pickSubjectFirst")}
            </p>
          ) : questions === undefined ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : questions.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {t("exams.bankEmpty")}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {topicItems.length > 1 ? (
                  <Select
                    items={topicItems}
                    value={topicFilter}
                    onValueChange={(value) => setTopicFilter(value as string)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="min-w-32"
                      aria-label={t("exams.filterTopic")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {topicItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Select
                  items={difficultyItems}
                  value={difficultyFilter}
                  onValueChange={(value) => setDifficultyFilter(value as string)}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-28"
                    aria-label={t("exams.filterDifficulty")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {difficultyItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  items={typeItems}
                  value={typeFilter}
                  onValueChange={(value) => setTypeFilter(value as string)}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-28"
                    aria-label={t("exams.filterType")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {filtered.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("exams.filteredEmpty")}
                </p>
              ) : (
                <ul className="flex flex-col divide-y rounded-xl border">
                  {filtered.map((question) => (
                    <QuestionRow
                      key={question._id}
                      question={question}
                      marks={selected[question._id]}
                      onToggle={toggleQuestion}
                      onMarks={setMarks}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {/* Sticky summary + submit bar */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-auto flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mb-6 md:px-6">
        <p className="text-sm font-medium tabular-nums">
          {versioned
            ? // M15 — live versioned total: Σ count×marksEach.
              t("exams.rulesTotal", { total: formatNumber(rulesTotal) })
            : t("exams.selectedSummary", {
                n: formatNumber(selectedCount),
                total: formatNumber(selectedTotal),
              })}
        </p>
        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link
                href={exam ? `/teacher/exams/${exam._id}` : "/teacher/exams"}
              />
            }
          >
            {t("common.cancel")}
          </Button>
          <form.AppForm>
            <form.SubmitButton
              disabled={subjectId !== null && questions === undefined}
            >
              {exam ? t("exams.saveChanges") : t("exams.saveDraft")}
            </form.SubmitButton>
          </form.AppForm>
        </div>
      </div>
    </form>
  );
}

function QuestionRow({
  question,
  marks,
  onToggle,
  onMarks,
}: {
  question: BankQuestion;
  marks: string | undefined;
  onToggle: (id: string, checked: boolean) => void;
  onMarks: (id: string, value: string) => void;
}) {
  const checked = marks !== undefined;
  return (
    <li className="flex items-center gap-3 p-3">
      {/* Implicit label: tapping the text toggles the checkbox. */}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onToggle(question._id, value === true)}
          aria-label={t("exams.selectQuestion", { text: question.text })}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-1 text-sm font-medium">
            {question.text}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant="outline">{t(TYPE_LABEL[question.type])}</Badge>
            <Badge
              variant="outline"
              className={DIFFICULTY_CLASS[question.difficulty]}
            >
              {t(DIFFICULTY_LABEL[question.difficulty])}
            </Badge>
            {question.topic ? (
              <Badge variant="ghost">{question.topic}</Badge>
            ) : null}
          </span>
        </span>
      </label>
      <Input
        type="number"
        dir="ltr"
        className="w-16 shrink-0 text-center"
        min={0.5}
        max={100}
        step="any"
        required
        disabled={!checked}
        value={marks ?? "1"}
        onChange={(e) => onMarks(question._id, e.target.value)}
        aria-label={t("exams.marksOf", { text: question.text })}
      />
    </li>
  );
}

/** M15 — one editable version rule: topic, difficulty, count, marks each. */
function RuleRow({
  rule,
  index,
  topicItems,
  difficultyItems,
  removable,
  onChange,
  onRemove,
}: {
  rule: RuleDraft;
  index: number;
  topicItems: Array<{ value: string; label: string }>;
  difficultyItems: Array<{ value: string; label: string }>;
  removable: boolean;
  onChange: (key: string, patch: Partial<RuleDraft>) => void;
  onRemove: (key: string) => void;
}) {
  const ruleNumber = formatNumber(index + 1);
  return (
    <li className="flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {t("exams.ruleLabel", { n: ruleNumber })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!removable}
          onClick={() => onRemove(rule.key)}
          aria-label={t("exams.removeRule", { n: ruleNumber })}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label id={`rule-${rule.key}-topic-label`}>
            {t("exams.ruleTopic")}
          </Label>
          <Select
            items={topicItems}
            value={rule.topic}
            onValueChange={(value) =>
              onChange(rule.key, { topic: (value as string | null) ?? ALL })
            }
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby={`rule-${rule.key}-topic-label`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {topicItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id={`rule-${rule.key}-difficulty-label`}>
            {t("exams.ruleDifficulty")}
          </Label>
          <Select
            items={difficultyItems}
            value={rule.difficulty}
            onValueChange={(value) =>
              onChange(rule.key, {
                difficulty: (value as string | null) ?? ALL,
              })
            }
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby={`rule-${rule.key}-difficulty-label`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {difficultyItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rule-${rule.key}-count`}>
            {t("exams.ruleCount")}
          </Label>
          <Input
            id={`rule-${rule.key}-count`}
            type="number"
            dir="ltr"
            inputMode="numeric"
            required
            min={1}
            max={50}
            step={1}
            value={rule.count}
            onChange={(e) => onChange(rule.key, { count: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rule-${rule.key}-marks`}>
            {t("exams.ruleMarksEach")}
          </Label>
          <Input
            id={`rule-${rule.key}-marks`}
            type="number"
            dir="ltr"
            required
            min={0.5}
            max={100}
            step="any"
            value={rule.marksEach}
            onChange={(e) => onChange(rule.key, { marksEach: e.target.value })}
          />
        </div>
      </div>
    </li>
  );
}
