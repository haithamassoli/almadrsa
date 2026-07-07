"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "./errors";

export type QuestionRow = {
  _id: Id<"questions">;
  type: "mcq" | "truefalse";
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  correctBool?: boolean;
  topic?: string;
  difficulty: "easy" | "medium" | "hard";
  teacherId: string;
};

type QuestionType = "mcq" | "truefalse";
type Difficulty = "easy" | "medium" | "hard";
type OptionDraft = { id: string; text: string };

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

// Monotonic option-id generator: ids only need to be unique + stable within a
// form, and a module counter guarantees that without a render-time ref read.
let optionIdSeq = 0;
function makeOption(text = ""): OptionDraft {
  optionIdSeq += 1;
  return { id: `opt-${optionIdSeq}`, text };
}

/** Create (question == null) or edit a bank question. */
export function QuestionDialog({
  open,
  onOpenChange,
  question,
  subjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: QuestionRow | null;
  subjectId: Id<"subjects"> | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {question === null
              ? t("questions.addQuestion")
              : t("questions.editQuestion")}
          </DialogTitle>
        </DialogHeader>
        {/* Keyed remount: each open (and each different question) starts from
            fresh initial state instead of re-seeding via an effect. */}
        {open && subjectId ? (
          <QuestionForm
            key={question?._id ?? "new"}
            question={question}
            subjectId={subjectId}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function QuestionForm({
  question,
  subjectId,
  onOpenChange,
}: {
  question: QuestionRow | null;
  subjectId: Id<"subjects">;
  onOpenChange: (open: boolean) => void;
}) {
  const createQuestion = useMutation(api.questions.create);
  const updateQuestion = useMutation(api.questions.update);

  const [type, setType] = useState<QuestionType>(question?.type ?? "mcq");
  const [text, setText] = useState(question?.text ?? "");
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    question?.type === "mcq" && question.options.length > 0
      ? question.options.map((o) => ({ id: o.id, text: o.text }))
      : [makeOption(), makeOption(), makeOption(), makeOption()],
  );
  const [correctOptionId, setCorrectOptionId] = useState<string>(
    question?.correctOptionId ?? options[0]?.id ?? "",
  );
  const [correctBool, setCorrectBool] = useState<boolean>(
    question?.correctBool ?? true,
  );
  const [topic, setTopic] = useState(question?.topic ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(
    question?.difficulty ?? "medium",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeItems = [
    { value: "mcq", label: t("questions.typeMcq") },
    { value: "truefalse", label: t("questions.typeTruefalse") },
  ];
  const difficultyItems = [
    { value: "easy", label: t("questions.difficultyEasy") },
    { value: "medium", label: t("questions.difficultyMedium") },
    { value: "hard", label: t("questions.difficultyHard") },
  ];

  function addOption() {
    setOptions((prev) =>
      prev.length >= MAX_OPTIONS ? prev : [...prev, makeOption()],
    );
  }

  function removeOption(id: string) {
    setOptions((prev) => {
      if (prev.length <= MIN_OPTIONS) return prev;
      const next = prev.filter((o) => o.id !== id);
      // If the correct option was removed, fall back to the first remaining.
      setCorrectOptionId((current) =>
        current === id ? (next[0]?.id ?? "") : current,
      );
      return next;
    });
  }

  function setOptionText(id: string, value: string) {
    setOptions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, text: value } : o)),
    );
  }

  /** Client validation mirroring convex/questions.ts cleanQuestionPayload. */
  function validate(): string | null {
    if (text.trim().length === 0) return t("questions.valText");
    if (type === "mcq") {
      if (options.some((o) => o.text.trim().length === 0)) {
        return t("questions.valOptionText");
      }
      if (!options.some((o) => o.id === correctOptionId)) {
        return t("questions.valCorrect");
      }
    }
    return null;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setPending(true);

    const payload =
      type === "mcq"
        ? {
            type: "mcq" as const,
            options: options.map((o) => ({ id: o.id, text: o.text.trim() })),
            correctOptionId,
            correctBool: undefined,
          }
        : {
            type: "truefalse" as const,
            options: [],
            correctOptionId: undefined,
            correctBool,
          };

    try {
      if (question === null) {
        await createQuestion({
          subjectId,
          text,
          topic: topic.trim() || undefined,
          difficulty,
          ...payload,
        });
        toast.success(t("questions.created"));
      } else {
        await updateQuestion({
          questionId: question._id,
          subjectId,
          text,
          topic: topic.trim() || undefined,
          difficulty,
          ...payload,
        });
        toast.success(t("questions.updated"));
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(mutationErrorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* Type — locked while editing (grading depends on it). */}
      <div className="flex flex-col gap-2">
        <Label id="q-type-label">{t("questions.typeLabel")}</Label>
        <Select
          items={typeItems}
          value={type}
          onValueChange={(value) => setType(value as QuestionType)}
          disabled={question !== null}
        >
          <SelectTrigger aria-labelledby="q-type-label" className="w-full">
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

      {/* Question text */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="q-text">{t("questions.questionTextLabel")}</Label>
        <Textarea
          id="q-text"
          required
          rows={3}
          maxLength={2000}
          placeholder={t("questions.questionTextPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {/* Answer editor */}
      {type === "mcq" ? (
        <div className="flex flex-col gap-2">
          <Label>{t("questions.optionsLabel")}</Label>
          <div className="flex flex-col gap-2">
            {options.map((option, index) => (
              <div key={option.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="q-correct"
                  className="size-4 shrink-0 accent-(--success)"
                  checked={correctOptionId === option.id}
                  onChange={() => setCorrectOptionId(option.id)}
                  aria-label={t("questions.markCorrect")}
                />
                <Input
                  required
                  maxLength={2000}
                  placeholder={t("questions.optionPlaceholder", {
                    n: index + 1,
                  })}
                  value={option.text}
                  onChange={(e) => setOptionText(option.id, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("questions.removeOption")}
                  disabled={options.length <= MIN_OPTIONS}
                  onClick={() => removeOption(option.id)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
          {options.length < MAX_OPTIONS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={addOption}
            >
              <Plus />
              {t("questions.addOption")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label>{t("questions.correctAnswerLabel")}</Label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: true, label: t("questions.answerTrue") },
              { value: false, label: t("questions.answerFalse") },
            ].map((segment) => (
              <Button
                key={String(segment.value)}
                type="button"
                variant={correctBool === segment.value ? "default" : "outline"}
                onClick={() => setCorrectBool(segment.value)}
              >
                {segment.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Topic + difficulty */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="q-topic">{t("questions.topicLabel")}</Label>
        <Input
          id="q-topic"
          maxLength={200}
          placeholder={t("questions.topicPlaceholder")}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label id="q-difficulty-label">{t("questions.difficultyLabel")}</Label>
        <Select
          items={difficultyItems}
          value={difficulty}
          onValueChange={(value) => setDifficulty(value as Difficulty)}
        >
          <SelectTrigger
            aria-labelledby="q-difficulty-label"
            className="w-full"
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

      {error ? (
        <p className={cn("text-sm text-destructive")}>{error}</p>
      ) : null}

      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
