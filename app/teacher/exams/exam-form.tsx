"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatNumber, t, type MessageKey } from "@/lib/i18n";
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

/** ms → <input type="datetime-local"> value (local wall time, minutes). */
function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
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

  const [title, setTitle] = useState(exam?.title ?? "");
  const [classId, setClassId] = useState<string | null>(exam?.classId ?? null);
  const [subjectId, setSubjectId] = useState<string | null>(
    exam?.subjectId ?? null,
  );
  const [startLocal, setStartLocal] = useState(
    exam ? msToLocalInput(exam.windowStart) : "",
  );
  const [endLocal, setEndLocal] = useState(
    exam ? msToLocalInput(exam.windowEnd) : "",
  );
  const [timeLimit, setTimeLimit] = useState(
    exam ? String(exam.timeLimitMinutes) : "30",
  );
  // M8 — per-student shuffle; default ON (server treats undefined as true).
  const [shuffle, setShuffle] = useState(exam ? exam.shuffle !== false : true);
  // questionId → marks (kept as input string); insertion order = exam order.
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (exam?.questions ?? []).map((q) => [q.questionId, String(q.marks)]),
    ),
  );
  const [pending, setPending] = useState(false);

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

  const topicItems = useMemo(() => {
    const topics = new Set<string>();
    for (const question of questions ?? []) {
      if (question.topic) topics.add(question.topic);
    }
    return [
      { value: ALL, label: t("exams.allTopics") },
      ...[...topics].map((topic) => ({ value: topic, label: topic })),
    ];
  }, [questions]);
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

  function onClassChange(value: string | null) {
    setClassId(value);
    const next = (classes ?? []).find((c) => c.classId === value);
    // Same-grade classes share subjects; otherwise the subject (and with it
    // the whole question selection) no longer applies.
    if (!next?.subjects.some((s) => s.subjectId === subjectId)) {
      setSubjectId(null);
      setSelected({});
      setTopicFilter(ALL);
    }
  }

  function onSubjectChange(value: string | null) {
    if (value === subjectId) return;
    setSubjectId(value);
    setSelected({});
    setTopicFilter(ALL);
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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!classId || !subjectId) {
      toast.error(t("exams.errMissingClassSubject"));
      return;
    }
    const windowStart = new Date(startLocal).getTime();
    const windowEnd = new Date(endLocal).getTime();
    if (
      !Number.isFinite(windowStart) ||
      !Number.isFinite(windowEnd) ||
      windowStart >= windowEnd
    ) {
      toast.error(t("exams.errWindowOrder"));
      return;
    }
    if (selectedCount === 0) {
      toast.error(t("exams.errNoQuestionsSelected"));
      return;
    }
    const questionsPayload = validSelected.map(([id, marks]) => ({
      questionId: id as Id<"questions">,
      marks: Number(marks),
    }));
    // Filtered-out rows unmount their inputs, so native min/max validation
    // cannot cover every selected question — recheck the whole selection.
    if (questionsPayload.some((q) => !(q.marks > 0) || q.marks > 100)) {
      toast.error(t("exams.errMarksRange"));
      return;
    }

    const payload = {
      title: title.trim(),
      classId: classId as Id<"classes">,
      subjectId: subjectId as Id<"subjects">,
      questions: questionsPayload,
      windowStart,
      windowEnd,
      timeLimitMinutes: Number(timeLimit),
      shuffle,
    };
    setPending(true);
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
      // pending stays true through the navigation.
    } catch (error) {
      toast.error(mutationErrorText(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-6">
      {/* Exam settings */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 md:col-span-2">
          <Label htmlFor="exam-title">{t("exams.fieldTitle")}</Label>
          <Input
            id="exam-title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label id="exam-class-label">{t("exams.fieldClass")}</Label>
          <Select
            items={classItems}
            value={classId}
            onValueChange={(value) =>
              onClassChange((value as string | null) ?? null)
            }
            disabled={classes === undefined}
          >
            <SelectTrigger className="w-full" aria-labelledby="exam-class-label">
              <SelectValue placeholder={t("exams.selectClass")} />
            </SelectTrigger>
            <SelectContent>
              {classItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label id="exam-subject-label">{t("exams.fieldSubject")}</Label>
          <Select
            items={subjectItems}
            value={subjectId}
            onValueChange={(value) =>
              onSubjectChange((value as string | null) ?? null)
            }
            disabled={classId === null}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="exam-subject-label"
            >
              <SelectValue placeholder={t("exams.selectSubject")} />
            </SelectTrigger>
            <SelectContent>
              {subjectItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="exam-window-start">{t("exams.fieldWindowStart")}</Label>
          <Input
            id="exam-window-start"
            type="datetime-local"
            dir="ltr"
            required
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="exam-window-end">{t("exams.fieldWindowEnd")}</Label>
          <Input
            id="exam-window-end"
            type="datetime-local"
            dir="ltr"
            required
            min={startLocal || undefined}
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="exam-time-limit">{t("exams.fieldTimeLimit")}</Label>
          <Input
            id="exam-time-limit"
            type="number"
            dir="ltr"
            inputMode="numeric"
            required
            min={1}
            max={300}
            step={1}
            value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)}
          />
        </div>

        {/* M8 — per-student question/option shuffle */}
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3 md:col-span-2">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="exam-shuffle">{t("exams.fieldShuffle")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("exams.shuffleHint")}
            </p>
          </div>
          <Switch
            id="exam-shuffle"
            checked={shuffle}
            onCheckedChange={(checked) => setShuffle(checked)}
          />
        </div>
      </div>

      {/* Question picker */}
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

      {/* Sticky summary + submit bar */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-auto flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mb-6 md:px-6">
        <p className="text-sm font-medium tabular-nums">
          {t("exams.selectedSummary", {
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
          <Button
            type="submit"
            disabled={pending || (subjectId !== null && questions === undefined)}
          >
            {pending ? <Spinner /> : null}
            {exam ? t("exams.saveChanges") : t("exams.saveDraft")}
          </Button>
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
