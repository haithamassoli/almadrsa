"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, Home, QrCode } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

/** Backend check-in error codes → Arabic messages. */
const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_token: "checkin.errInvalidToken",
  token_expired: "checkin.errTokenExpired",
  not_enrolled: "checkin.errNotEnrolled",
};

function errorText(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    const key = ERROR_KEYS[error.data];
    if (key) return t(key);
  }
  return t("checkin.errGeneric");
}

type State =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; lessonTitle: string; alreadyMarked: boolean }
  | { kind: "error"; message: string };

export default function CheckinPage() {
  // useSearchParams needs a Suspense boundary (Next App Router).
  return (
    <Suspense fallback={<CheckinShell>{null}</CheckinShell>}>
      <CheckinInner />
    </Suspense>
  );
}

function CheckinShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-8">
      <Card className="w-full max-w-sm rounded-2xl text-center">{children}</Card>
    </div>
  );
}

function CheckinInner() {
  const searchParams = useSearchParams();
  const payload = searchParams.get("t");
  const { sessionToken } = useStudentSession();
  const checkIn = useMutation(api.checkin.checkIn);
  const [state, setState] = useState<State>({ kind: "idle" });

  // Explicit button, never auto-submit on mount: an accidental scan should
  // never silently mark a student present.
  async function submit() {
    if (!sessionToken || !payload) {
      setState({ kind: "error", message: t("checkin.errInvalidToken") });
      return;
    }
    setState({ kind: "pending" });
    try {
      const result = await checkIn({ sessionToken, payload });
      setState({
        kind: "success",
        lessonTitle: result.lessonTitle,
        alreadyMarked: result.alreadyMarked,
      });
    } catch (error) {
      setState({ kind: "error", message: errorText(error) });
    }
  }

  if (state.kind === "success") {
    return (
      <CheckinShell>
        <CardHeader className="flex flex-col items-center gap-3">
          <span
            aria-hidden
            className="flex size-14 items-center justify-center rounded-full bg-success/10 text-success"
          >
            <Check className="size-7" />
          </span>
          <CardTitle className="text-lg">
            {state.alreadyMarked
              ? t("checkin.alreadyMarked")
              : t("checkin.successMarked", { title: state.lessonTitle })}
          </CardTitle>
          {state.alreadyMarked && state.lessonTitle ? (
            <CardDescription>{state.lessonTitle}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link href="/portal" />}
          >
            <Home />
            {t("checkin.home")}
          </Button>
        </CardContent>
      </CheckinShell>
    );
  }

  return (
    <CheckinShell>
      <CardHeader className="items-center gap-3">
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <QrCode className="size-7" />
        </span>
        <CardTitle className="text-lg">{t("checkin.title")}</CardTitle>
        <CardDescription>{t("checkin.confirmDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          className="w-full"
          disabled={state.kind === "pending"}
          onClick={() => void submit()}
        >
          {state.kind === "pending" ? <Spinner /> : null}
          {t("checkin.confirmButton")}
        </Button>
        {state.kind === "error" ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : null}
      </CardContent>
    </CheckinShell>
  );
}
