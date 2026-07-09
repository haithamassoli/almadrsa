"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { z } from "zod";
import { useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import {
  getDeviceToken,
  getSessionToken,
  setSession,
  studentFetch,
} from "@/lib/student-session";

type Step = "code" | "pin" | "pinSetup";

export default function CodeLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("code");
  // The backend "invalid code / pin / rate-limited" outcome is a server
  // response, not field validation, so it stays a local error above the button.
  const [error, setError] = useState<string | null>(null);

  const codeForm = useAppForm({
    defaultValues: { code: "" },
    validators: {
      onSubmit: z.object({
        code: z.string().min(1, t("common.requiredField")),
      }),
    },
    onSubmit: async () => {
      await submitLogin();
    },
  });

  const pinForm = useAppForm({
    defaultValues: { pin: "", rememberDevice: true },
    validators: {
      onSubmit: z.object({
        pin: z.string().min(1, t("common.requiredField")),
        rememberDevice: z.boolean(),
      }),
    },
    onSubmit: async ({ value }) => {
      await submitLogin(value.pin);
    },
  });

  const pinSetupForm = useAppForm({
    defaultValues: { setupPin: "" },
    validators: {
      onSubmit: z.object({
        setupPin: z.string().min(1, t("common.requiredField")),
      }),
    },
    onSubmit: async ({ value }) => {
      await submitPinSetup(value.setupPin);
    },
  });

  function fail(message: string) {
    setError(message);
  }

  async function submitLogin(withPin?: string) {
    setError(null);
    try {
      const body: Record<string, unknown> = {
        code: codeForm.state.values.code,
      };
      const deviceToken = getDeviceToken();
      if (deviceToken) body.deviceToken = deviceToken;
      if (withPin) {
        body.pin = withPin;
        body.rememberDevice = pinForm.state.values.rememberDevice;
      }
      const result = await studentFetch("/student/login", body);
      if (result.ok && result.sessionToken) {
        setSession({
          sessionToken: result.sessionToken,
          deviceToken: result.deviceToken,
        });
        if (result.needsPinSetup) {
          setStep("pinSetup");
          return;
        }
        router.replace("/portal");
        return;
      }
      if (result.needsPin) {
        setStep("pin");
        return;
      }
      switch (result.error) {
        case "invalid_pin":
          fail(t("auth.pinInvalid"));
          break;
        case "rate_limited":
          fail(t("auth.tooManyAttempts"));
          break;
        case "invalid_code":
          fail(t("auth.invalidCode"));
          break;
        default:
          // bad_request / unexpected shapes → generic error.
          fail(t("common.errorGeneric"));
      }
    } catch {
      fail(t("common.errorGeneric"));
    }
  }

  async function submitPinSetup(setupPin: string) {
    setError(null);
    try {
      const sessionToken = getSessionToken();
      if (sessionToken && setupPin.length >= 4) {
        await studentFetch("/student/set-pin", { sessionToken, pin: setupPin });
      }
      router.replace("/portal");
    } catch {
      // PIN setup is optional — never block portal entry on it.
      router.replace("/portal");
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
            <KeyRound className="size-6" aria-hidden />
          </div>
          <CardTitle className="text-xl">
            {step === "pinSetup"
              ? t("auth.pinSetupTitle")
              : t("auth.studentLogin")}
          </CardTitle>
          <CardDescription>
            {step === "code" ? t("auth.accessCodeHelp") : null}
            {step === "pin" ? t("auth.pinHelp") : null}
            {step === "pinSetup" ? t("auth.pinSetupHelp") : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "code" ? (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                codeForm.handleSubmit();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">{t("auth.accessCode")}</Label>
                <codeForm.AppField name="code">
                  {(field) => (
                    <Input
                      id="code"
                      dir="ltr"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder={t("auth.accessCodePlaceholder")}
                      className="h-11 text-center font-mono text-base tracking-wider uppercase"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  )}
                </codeForm.AppField>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <codeForm.AppForm>
                <codeForm.Subscribe selector={(s) => s.values.code.length < 8}>
                  {(tooShort) => (
                    <codeForm.SubmitButton disabled={tooShort}>
                      {t("auth.signIn")}
                    </codeForm.SubmitButton>
                  )}
                </codeForm.Subscribe>
              </codeForm.AppForm>
            </form>
          ) : null}

          {step === "pin" ? (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                pinForm.handleSubmit();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="pin">{t("auth.pin")}</Label>
                <pinForm.AppField name="pin">
                  {(field) => (
                    <Input
                      id="pin"
                      dir="ltr"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      minLength={4}
                      maxLength={6}
                      className="h-11 text-center font-mono text-lg tracking-[0.5em]"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(e.target.value.replace(/\D/g, ""))
                      }
                      onBlur={field.handleBlur}
                    />
                  )}
                </pinForm.AppField>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <pinForm.AppField name="rememberDevice">
                  {(field) => (
                    <Checkbox
                      checked={field.state.value}
                      onCheckedChange={(v) => field.handleChange(v === true)}
                    />
                  )}
                </pinForm.AppField>
                {t("auth.rememberDevice")}
              </label>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <pinForm.AppForm>
                <pinForm.Subscribe selector={(s) => s.values.pin.length < 4}>
                  {(tooShort) => (
                    <pinForm.SubmitButton disabled={tooShort}>
                      {t("auth.signIn")}
                    </pinForm.SubmitButton>
                  )}
                </pinForm.Subscribe>
              </pinForm.AppForm>
            </form>
          ) : null}

          {step === "pinSetup" ? (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                pinSetupForm.handleSubmit();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="setupPin">{t("auth.pin")}</Label>
                <pinSetupForm.AppField name="setupPin">
                  {(field) => (
                    <Input
                      id="setupPin"
                      dir="ltr"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      minLength={4}
                      maxLength={6}
                      className="h-11 text-center font-mono text-lg tracking-[0.5em]"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(e.target.value.replace(/\D/g, ""))
                      }
                      onBlur={field.handleBlur}
                    />
                  )}
                </pinSetupForm.AppField>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <pinSetupForm.AppForm>
                <pinSetupForm.Subscribe
                  selector={(s) => ({
                    submitting: s.isSubmitting,
                    tooShort: s.values.setupPin.length < 4,
                  })}
                >
                  {({ submitting, tooShort }) => (
                    <div className="flex gap-2">
                      <pinSetupForm.SubmitButton
                        className="flex-1"
                        disabled={tooShort}
                      >
                        {t("common.save")}
                      </pinSetupForm.SubmitButton>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={submitting}
                        onClick={() => router.replace("/portal")}
                      >
                        {t("auth.pinSkip")}
                      </Button>
                    </div>
                  )}
                </pinSetupForm.Subscribe>
              </pinSetupForm.AppForm>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
