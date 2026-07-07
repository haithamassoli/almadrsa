"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
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
import { formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mutationErrorText } from "./errors";

/** Row shape returned by api.questions.list (M8: all six types + image). */
export type QuestionRow = {
  _id: Id<"questions">;
  type: "mcq" | "truefalse" | "fillblank" | "matching" | "ordering" | "essay";
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  correctBool?: boolean;
  blanks?: Array<{ id: string; acceptedAnswers: Array<string> }>;
  pairs?: Array<{ id: string; left: string; right: string }>;
  items?: Array<{ id: string; text: string }>;
  rubricText?: string;
  imageId?: Id<"_storage">;
  imageUrl?: string;
  topic?: string;
  difficulty: "easy" | "medium" | "hard";
  teacherId: string;
};

type QuestionType = QuestionRow["type"];
type Difficulty = "easy" | "medium" | "hard";
type OptionDraft = { id: string; text: string };
type BlankDraft = { id: string; answersRaw: string };
type PairDraft = { id: string; left: string; right: string };
type ItemDraft = { id: string; text: string };

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_BLANKS = 10;
const MAX_ACCEPTED_ANSWERS = 20;
const MAX_ACCEPTED_ANSWER_LENGTH = 200;
const MIN_PAIRS = 2;
const MAX_PAIRS = 8;
const MIN_ITEMS = 2;
const MAX_ITEMS = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Mirrors convex/questions.ts: one run of ≥4 underscores per blank. */
const BLANK_PLACEHOLDER = /_{4,}/g;

// Monotonic draft-id generator: ids only need to be unique + stable within a
// form (pair ids also become answer record keys — ASCII-safe by shape).
let draftIdSeq = 0;
function draftId(prefix: string): string {
  draftIdSeq += 1;
  return `${prefix}-${draftIdSeq}`;
}
const makeOption = (text = ""): OptionDraft => ({ id: draftId("opt"), text });
const makeBlank = (answersRaw = ""): BlankDraft => ({
  id: draftId("blank"),
  answersRaw,
});
const makePair = (left = "", right = ""): PairDraft => ({
  id: draftId("pair"),
  left,
  right,
});
const makeItem = (text = ""): ItemDraft => ({ id: draftId("item"), text });

/** Comma-separated accepted answers (Arabic or Latin commas) → array. */
function parseAcceptedAnswers(raw: string): Array<string> {
  return raw
    .split(/[,،]/)
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0);
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
  const generateImageUploadUrl = useMutation(
    api.files.generateQuestionImageUploadUrl,
  );

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
  const [blanks, setBlanks] = useState<BlankDraft[]>(() =>
    question?.type === "fillblank" && (question.blanks?.length ?? 0) > 0
      ? (question.blanks ?? []).map((blank) => ({
          id: blank.id,
          answersRaw: blank.acceptedAnswers.join("، "),
        }))
      : [makeBlank()],
  );
  const [pairs, setPairs] = useState<PairDraft[]>(() =>
    question?.type === "matching" && (question.pairs?.length ?? 0) >= MIN_PAIRS
      ? (question.pairs ?? []).map((pair) => ({
          id: pair.id,
          left: pair.left,
          right: pair.right,
        }))
      : [makePair(), makePair()],
  );
  const [items, setItems] = useState<ItemDraft[]>(() =>
    question?.type === "ordering" && (question.items?.length ?? 0) >= MIN_ITEMS
      ? (question.items ?? []).map((item) => ({ id: item.id, text: item.text }))
      : [makeItem(), makeItem(), makeItem()],
  );
  const [rubric, setRubric] = useState(question?.rubricText ?? "");
  const [topic, setTopic] = useState(question?.topic ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(
    question?.difficulty ?? "medium",
  );

  // Image attach (any type): the picked file uploads on save; an existing
  // image survives unless explicitly removed or replaced.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const imagePreviewRef = useRef<string | null>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unmount cleanup of the preview object URL (external resource).
  useEffect(() => {
    return () => {
      if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    };
  }, []);

  const typeItems = [
    { value: "mcq", label: t("questions.typeMcq") },
    { value: "truefalse", label: t("questions.typeTruefalse") },
    { value: "fillblank", label: t("questions.typeFillblank") },
    { value: "matching", label: t("questions.typeMatching") },
    { value: "ordering", label: t("questions.typeOrdering") },
    { value: "essay", label: t("questions.typeEssay") },
  ];
  const difficultyItems = [
    { value: "easy", label: t("questions.difficultyEasy") },
    { value: "medium", label: t("questions.difficultyMedium") },
    { value: "hard", label: t("questions.difficultyHard") },
  ];

  // ——— MCQ options ———

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

  // ——— Fill-blank rows ———

  function addBlank() {
    setBlanks((prev) =>
      prev.length >= MAX_BLANKS ? prev : [...prev, makeBlank()],
    );
  }

  function removeBlank(id: string) {
    setBlanks((prev) =>
      prev.length <= 1 ? prev : prev.filter((blank) => blank.id !== id),
    );
  }

  function setBlankAnswers(id: string, value: string) {
    setBlanks((prev) =>
      prev.map((blank) =>
        blank.id === id ? { ...blank, answersRaw: value } : blank,
      ),
    );
  }

  // ——— Matching pairs ———

  function addPair() {
    setPairs((prev) => (prev.length >= MAX_PAIRS ? prev : [...prev, makePair()]));
  }

  function removePair(id: string) {
    setPairs((prev) =>
      prev.length <= MIN_PAIRS ? prev : prev.filter((pair) => pair.id !== id),
    );
  }

  function setPairSide(id: string, side: "left" | "right", value: string) {
    setPairs((prev) =>
      prev.map((pair) =>
        pair.id === id ? { ...pair, [side]: value } : pair,
      ),
    );
  }

  // ——— Ordering items ———

  function addItem() {
    setItems((prev) => (prev.length >= MAX_ITEMS ? prev : [...prev, makeItem()]));
  }

  function removeItem(id: string) {
    setItems((prev) =>
      prev.length <= MIN_ITEMS ? prev : prev.filter((item) => item.id !== id),
    );
  }

  function setItemText(id: string, value: string) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, text: value } : item)),
    );
  }

  function moveItem(index: number, delta: -1 | 1) {
    setItems((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // ——— Image attach ———

  const displayedImageUrl =
    imagePreview ?? (imageRemoved ? null : (question?.imageUrl ?? null));

  function onPickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file fires onChange again.
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("questions.imageInvalidType"));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t("questions.imageTooLarge"));
      return;
    }
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    const url = URL.createObjectURL(file);
    imagePreviewRef.current = url;
    setImageFile(file);
    setImagePreview(url);
    setImageRemoved(false);
  }

  function removeImage() {
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    imagePreviewRef.current = null;
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(true);
  }

  // Live placeholder count for the fill-blank hint (mirrors the server).
  const placeholderCount =
    type === "fillblank"
      ? (text.trim().match(BLANK_PLACEHOLDER)?.length ?? 0)
      : 0;

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
    if (type === "fillblank") {
      if (placeholderCount !== blanks.length) {
        return t("questions.valBlankCount", {
          rows: formatNumber(blanks.length),
          placeholders: formatNumber(placeholderCount),
        });
      }
      for (const blank of blanks) {
        const answers = parseAcceptedAnswers(blank.answersRaw);
        if (answers.length === 0) return t("questions.valBlankAnswers");
        if (answers.length > MAX_ACCEPTED_ANSWERS) {
          return t("questions.valBlankAnswersMax");
        }
        if (answers.some((a) => a.length > MAX_ACCEPTED_ANSWER_LENGTH)) {
          return t("questions.valBlankAnswerLength");
        }
      }
    }
    if (
      type === "matching" &&
      pairs.some(
        (pair) => pair.left.trim().length === 0 || pair.right.trim().length === 0,
      )
    ) {
      return t("questions.valPairText");
    }
    if (
      type === "ordering" &&
      items.some((item) => item.text.trim().length === 0)
    ) {
      return t("questions.valItemText");
    }
    return null;
  }

  /** Per-type payload; type-foreign fields stay absent (server forbids them). */
  function buildTypePayload() {
    switch (type) {
      case "mcq":
        return {
          type: "mcq" as const,
          options: options.map((o) => ({ id: o.id, text: o.text.trim() })),
          correctOptionId,
        };
      case "truefalse":
        return { type: "truefalse" as const, options: [], correctBool };
      case "fillblank":
        return {
          type: "fillblank" as const,
          options: [],
          blanks: blanks.map((blank) => ({
            id: blank.id,
            acceptedAnswers: parseAcceptedAnswers(blank.answersRaw),
          })),
        };
      case "matching":
        return {
          type: "matching" as const,
          options: [],
          pairs: pairs.map((pair) => ({
            id: pair.id,
            left: pair.left.trim(),
            right: pair.right.trim(),
          })),
        };
      case "ordering":
        return {
          type: "ordering" as const,
          options: [],
          items: items.map((item) => ({ id: item.id, text: item.text.trim() })),
        };
      case "essay":
        return {
          type: "essay" as const,
          options: [],
          rubricText: rubric.trim() || undefined,
        };
    }
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

    try {
      // Upload the picked image first; keep/remove the stored one otherwise.
      let imageId: Id<"_storage"> | undefined = imageRemoved
        ? undefined
        : question?.imageId;
      if (imageFile) {
        try {
          const uploadUrl = await generateImageUploadUrl({});
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": imageFile.type },
            body: imageFile,
          });
          if (!response.ok) throw new Error("upload_failed");
          const { storageId } = (await response.json()) as {
            storageId: Id<"_storage">;
          };
          imageId = storageId;
        } catch {
          toast.error(t("questions.imageUploadError"));
          return;
        }
      }

      const payload = {
        subjectId,
        text,
        topic: topic.trim() || undefined,
        difficulty,
        imageId,
        ...buildTypePayload(),
      };
      if (question === null) {
        await createQuestion(payload);
        toast.success(t("questions.created"));
      } else {
        await updateQuestion({ questionId: question._id, ...payload });
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
        {type === "fillblank" ? (
          <p className="text-xs text-muted-foreground">
            {t("questions.fillblankHint")} ·{" "}
            {t("questions.blanksDetected", {
              n: formatNumber(placeholderCount),
            })}
          </p>
        ) : null}
      </div>

      {/* Per-type answer editor */}
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
      ) : type === "truefalse" ? (
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
      ) : type === "fillblank" ? (
        <div className="flex flex-col gap-2">
          <Label>{t("questions.blanksLabel")}</Label>
          <div className="flex flex-col gap-2">
            {blanks.map((blank, index) => (
              <div key={blank.id} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-sm text-muted-foreground tabular-nums">
                  {formatNumber(index + 1)}
                </span>
                <Input
                  required
                  maxLength={2000}
                  placeholder={t("questions.blankPlaceholder", { n: index + 1 })}
                  value={blank.answersRaw}
                  onChange={(e) => setBlankAnswers(blank.id, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("questions.removeBlank")}
                  disabled={blanks.length <= 1}
                  onClick={() => removeBlank(blank.id)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
          {blanks.length < MAX_BLANKS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={addBlank}
            >
              <Plus />
              {t("questions.addBlank")}
            </Button>
          ) : null}
        </div>
      ) : type === "matching" ? (
        <div className="flex flex-col gap-2">
          <Label>{t("questions.pairsLabel")}</Label>
          <div className="flex flex-col gap-2">
            {pairs.map((pair, index) => (
              <div key={pair.id} className="flex items-center gap-2">
                <Input
                  required
                  maxLength={500}
                  placeholder={t("questions.pairLeftPlaceholder", {
                    n: index + 1,
                  })}
                  value={pair.left}
                  onChange={(e) => setPairSide(pair.id, "left", e.target.value)}
                />
                <Input
                  required
                  maxLength={500}
                  placeholder={t("questions.pairRightPlaceholder", {
                    n: index + 1,
                  })}
                  value={pair.right}
                  onChange={(e) =>
                    setPairSide(pair.id, "right", e.target.value)
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("questions.removePair")}
                  disabled={pairs.length <= MIN_PAIRS}
                  onClick={() => removePair(pair.id)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
          {pairs.length < MAX_PAIRS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={addPair}
            >
              <Plus />
              {t("questions.addPair")}
            </Button>
          ) : null}
        </div>
      ) : type === "ordering" ? (
        <div className="flex flex-col gap-2">
          <Label>{t("questions.itemsLabel")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("questions.orderingHint")}
          </p>
          <div className="flex flex-col gap-2">
            {items.map((item, index) => (
              <div key={item.id} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-sm text-muted-foreground tabular-nums">
                  {formatNumber(index + 1)}
                </span>
                <Input
                  required
                  maxLength={500}
                  placeholder={t("questions.itemPlaceholder", { n: index + 1 })}
                  value={item.text}
                  onChange={(e) => setItemText(item.id, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("questions.moveUp")}
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("questions.moveDown")}
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("questions.removeItem")}
                  disabled={items.length <= MIN_ITEMS}
                  onClick={() => removeItem(item.id)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
          {items.length < MAX_ITEMS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={addItem}
            >
              <Plus />
              {t("questions.addItem")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="q-rubric">{t("questions.rubricLabel")}</Label>
          <Textarea
            id="q-rubric"
            rows={3}
            maxLength={2000}
            placeholder={t("questions.rubricPlaceholder")}
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
          />
        </div>
      )}

      {/* Image attach (any type) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="q-image">{t("questions.imageLabel")}</Label>
        {displayedImageUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage / blob URL; next/image remotePatterns not configured */}
            <img
              src={displayedImageUrl}
              alt={t("questions.imageAlt")}
              className="size-20 shrink-0 rounded-lg border object-cover"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={removeImage}
            >
              <X />
              {t("questions.imageRemove")}
            </Button>
          </div>
        ) : (
          <Input
            id="q-image"
            type="file"
            accept="image/*"
            onChange={onPickImage}
          />
        )}
      </div>

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
