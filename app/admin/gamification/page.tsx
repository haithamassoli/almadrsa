"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

type Config = FunctionReturnType<typeof api.gamification.getConfig>;

const MAX_THRESHOLDS = 5;

type ThresholdRow = { id: number; minPct: string; points: string };

function parseNonNeg(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const numberInputProps = {
  type: "number" as const,
  dir: "ltr" as const,
  inputMode: "numeric" as const,
  min: 0,
  className: "w-28 text-center",
};

function ConfigForm({ config }: { config: Config }) {
  const saveConfig = useMutation(api.gamification.saveConfig);
  const nextId = useRef(config.examThresholds.length);

  const [present, setPresent] = useState(String(config.presentPoints));
  const [late, setLate] = useState(String(config.latePoints));
  const [thresholds, setThresholds] = useState<Array<ThresholdRow>>(() =>
    config.examThresholds.map((row, i) => ({
      id: i,
      minPct: String(row.minPct),
      points: String(row.points),
    })),
  );
  const [saving, setSaving] = useState(false);

  function updateThreshold(
    id: number,
    field: "minPct" | "points",
    value: string,
  ) {
    setThresholds((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  }

  function addThreshold() {
    setThresholds((rows) =>
      rows.length >= MAX_THRESHOLDS
        ? rows
        : [...rows, { id: nextId.current++, minPct: "", points: "" }],
    );
  }

  function removeThreshold(id: number) {
    setThresholds((rows) =>
      rows.length <= 1 ? rows : rows.filter((row) => row.id !== id),
    );
  }

  async function onSave() {
    const presentN = parseNonNeg(present);
    const lateN = parseNonNeg(late);
    const parsedThresholds = thresholds.map((row) => ({
      minPct: parseNonNeg(row.minPct),
      points: parseNonNeg(row.points),
    }));
    if (
      presentN === null ||
      lateN === null ||
      parsedThresholds.some((row) => row.minPct === null || row.points === null)
    ) {
      toast.error(t("gamification.errInvalidConfig"));
      return;
    }
    setSaving(true);
    try {
      await saveConfig({
        presentPoints: presentN,
        latePoints: lateN,
        examThresholds: parsedThresholds.map((row) => ({
          minPct: row.minPct as number,
          points: row.points as number,
        })),
      });
      toast.success(t("gamification.saved"));
    } catch (err) {
      toast.error(mutationErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>{t("gamification.attendanceCardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="present-points">{t("gamification.present")}</Label>
              <Input
                {...numberInputProps}
                id="present-points"
                value={present}
                onChange={(e) => setPresent(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="late-points">{t("gamification.late")}</Label>
              <Input
                {...numberInputProps}
                id="late-points"
                value={late}
                onChange={(e) => setLate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>{t("gamification.thresholdsCardTitle")}</CardTitle>
          <CardDescription>{t("gamification.thresholdsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {thresholds.map((row) => (
              <div key={row.id} className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`minpct-${row.id}`}>
                    {t("gamification.minPct")}
                  </Label>
                  <Input
                    {...numberInputProps}
                    max={100}
                    id={`minpct-${row.id}`}
                    value={row.minPct}
                    onChange={(e) =>
                      updateThreshold(row.id, "minPct", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`points-${row.id}`}>
                    {t("gamification.thresholdPoints")}
                  </Label>
                  <Input
                    {...numberInputProps}
                    id={`points-${row.id}`}
                    value={row.points}
                    onChange={(e) =>
                      updateThreshold(row.id, "points", e.target.value)
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("gamification.removeThreshold")}
                  disabled={thresholds.length <= 1}
                  onClick={() => removeThreshold(row.id)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={thresholds.length >= MAX_THRESHOLDS}
              onClick={addThreshold}
            >
              <Plus className="size-4" aria-hidden />
              {t("gamification.addThreshold")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <Button disabled={saving} onClick={onSave}>
          {saving ? <Spinner className="size-3.5" /> : null}
          {t("gamification.save")}
        </Button>
      </div>
    </div>
  );
}

function ConfigSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

export default function GamificationPage() {
  const config = useQuery(api.gamification.getConfig);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="heading-rule text-2xl font-black">
          {t("gamification.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("gamification.description")}
        </p>
      </div>

      {config === undefined ? (
        <ConfigSkeleton />
      ) : (
        <ConfigForm config={config} />
      )}
    </div>
  );
}
