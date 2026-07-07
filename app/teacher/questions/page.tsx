"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  Check,
  EllipsisVertical,
  ListChecks,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "./errors";
import { QuestionDialog, type QuestionRow } from "./question-dialog";

const ALL = "all";

const TYPE_LABEL = {
  mcq: "questions.typeMcq",
  truefalse: "questions.typeTruefalse",
} as const;

const DIFFICULTY_LABEL = {
  easy: "questions.difficultyEasy",
  medium: "questions.difficultyMedium",
  hard: "questions.difficultyHard",
} as const;

/** success-toned / accent / destructive-toned per difficulty. */
const DIFFICULTY_BADGE_CLASS = {
  easy: "border-transparent bg-success/10 text-success",
  medium: "border-transparent bg-accent text-accent-foreground",
  hard: "border-transparent bg-destructive/10 text-destructive",
} as const;

export default function QuestionsPage() {
  const classes = useQuery(api.lessons.listMyClasses, {});

  const [subject, setSubject] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [difficultyFilter, setDifficultyFilter] = useState<string>(ALL);
  const [topicSearch, setTopicSearch] = useState("");
  const deferredTopic = useDeferredValue(topicSearch);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<QuestionRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<QuestionRow | null>(null);
  const [actionPending, setActionPending] = useState(false);

  // Union of the caller's subjects, de-duplicated by subjectId.
  const subjectItems = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    for (const cls of classes ?? []) {
      for (const s of cls.subjects) {
        if (!map.has(s.subjectId)) {
          map.set(s.subjectId, {
            value: s.subjectId,
            label: t("questions.subjectOptionLabel", {
              subject: s.name,
              grade: cls.gradeName,
            }),
          });
        }
      }
    }
    return [...map.values()];
  }, [classes]);

  // Auto-select the first subject without an effect: derive the effective
  // value, letting an explicit pick override it.
  const effectiveSubject = subject ?? subjectItems[0]?.value ?? null;

  const questions = useQuery(
    api.questions.list,
    effectiveSubject
      ? { subjectId: effectiveSubject as Id<"subjects"> }
      : "skip",
  );
  const archiveQuestion = useMutation(api.questions.archive);

  const typeItems = useMemo(
    () => [
      { value: ALL, label: t("questions.allTypes") },
      { value: "mcq", label: t("questions.typeMcq") },
      { value: "truefalse", label: t("questions.typeTruefalse") },
    ],
    [],
  );
  const difficultyItems = useMemo(
    () => [
      { value: ALL, label: t("questions.allDifficulties") },
      { value: "easy", label: t("questions.difficultyEasy") },
      { value: "medium", label: t("questions.difficultyMedium") },
      { value: "hard", label: t("questions.difficultyHard") },
    ],
    [],
  );

  const filtered = useMemo(() => {
    const topic = deferredTopic.trim().toLowerCase();
    return (questions ?? []).filter((q) => {
      if (typeFilter !== ALL && q.type !== typeFilter) return false;
      if (difficultyFilter !== ALL && q.difficulty !== difficultyFilter) {
        return false;
      }
      if (topic && !(q.topic ?? "").toLowerCase().includes(topic)) {
        return false;
      }
      return true;
    });
  }, [questions, typeFilter, difficultyFilter, deferredTopic]);

  async function confirmArchive() {
    if (!archiveTarget) return;
    setActionPending(true);
    try {
      await archiveQuestion({ questionId: archiveTarget._id });
      toast.success(t("questions.archived"));
      setArchiveTarget(null);
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-rule text-2xl font-black">
          {t("questions.title")}
        </h1>
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={effectiveSubject === null}
        >
          <Plus />
          {t("questions.addQuestion")}
        </Button>
      </div>

      {/* Subject picker */}
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label id="q-subject-label">{t("questions.subjectLabel")}</Label>
        <Select
          items={subjectItems}
          value={effectiveSubject}
          onValueChange={(value) => setSubject((value as string | null) ?? null)}
          disabled={classes === undefined || subjectItems.length === 0}
        >
          <SelectTrigger
            className="w-full"
            aria-labelledby="q-subject-label"
          >
            <SelectValue />
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

      {effectiveSubject === null ? (
        classes === undefined ? (
          <QuestionsSkeleton />
        ) : (
          <Empty className="flex-1 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecks />
              </EmptyMedia>
              <EmptyTitle>{t("questions.noSubjectTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("questions.noSubjectBody")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <>
          {/* Client-side filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={typeItems}
              value={typeFilter}
              onValueChange={(value) => setTypeFilter(value as string)}
            >
              <SelectTrigger
                className="min-w-40"
                aria-label={t("questions.typeFilter")}
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
            <Select
              items={difficultyItems}
              value={difficultyFilter}
              onValueChange={(value) => setDifficultyFilter(value as string)}
            >
              <SelectTrigger
                className="min-w-32"
                aria-label={t("questions.difficultyFilter")}
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
            <Input
              className="w-full max-w-xs"
              placeholder={t("questions.topicFilterPlaceholder")}
              value={topicSearch}
              onChange={(e) => setTopicSearch(e.target.value)}
              aria-label={t("questions.topicFilter")}
            />
            {questions !== undefined ? (
              <p className="ms-auto text-sm text-muted-foreground">
                {t("questions.count", { count: filtered.length })}
              </p>
            ) : null}
          </div>

          {questions === undefined ? (
            <QuestionsSkeleton />
          ) : questions.length === 0 ? (
            <Empty className="flex-1 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListChecks />
                </EmptyMedia>
                <EmptyTitle>{t("questions.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("questions.emptyBody")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  {t("questions.firstQuestion")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {t("questions.noMatch")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((question) => (
                <QuestionCard
                  key={question._id}
                  question={question}
                  onEdit={() => setEditTarget(question)}
                  onArchive={() => setArchiveTarget(question)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Create / edit */}
      <QuestionDialog
        open={createOpen || editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
        question={editTarget}
        subjectId={
          effectiveSubject ? (effectiveSubject as Id<"subjects">) : null
        }
      />

      {/* Archive confirm */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("questions.archiveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("questions.archiveConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionPending}
              onClick={confirmArchive}
            >
              {t("questions.archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function QuestionCard({
  question,
  onEdit,
  onArchive,
}: {
  question: QuestionRow;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <p className="line-clamp-2 flex-1 font-medium">{question.text}</p>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-me-1 shrink-0"
                  aria-label={t("common.actions")}
                />
              }
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                {t("common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onArchive}>
                <Archive />
                {t("questions.archive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(TYPE_LABEL[question.type])}</Badge>
          <Badge className={DIFFICULTY_BADGE_CLASS[question.difficulty]}>
            {t(DIFFICULTY_LABEL[question.difficulty])}
          </Badge>
          {question.topic ? (
            <Badge variant="outline">{question.topic}</Badge>
          ) : null}
        </div>

        {question.type === "mcq" ? (
          <ul className="flex flex-col gap-1.5">
            {question.options.map((option) => {
              const correct = option.id === question.correctOptionId;
              return (
                <li
                  key={option.id}
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    correct ? "font-medium text-success" : "text-foreground",
                  )}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      correct ? "text-success" : "text-transparent",
                    )}
                    aria-hidden
                  />
                  <span>{option.text}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: true, label: t("questions.answerTrue") },
              { value: false, label: t("questions.answerFalse") },
            ].map((segment) => {
              const correct = question.correctBool === segment.value;
              return (
                <span
                  key={String(segment.value)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm",
                    correct
                      ? "border-transparent bg-success/10 font-medium text-success"
                      : "text-muted-foreground",
                  )}
                >
                  {correct ? (
                    <Check className="size-4 shrink-0" aria-hidden />
                  ) : null}
                  {segment.label}
                </span>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuestionsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-2xl" />
      ))}
    </div>
  );
}
