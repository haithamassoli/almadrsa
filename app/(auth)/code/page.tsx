"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
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
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function fail(message: string) {
    setError(message);
    setPending(false);
  }

  async function submitLogin(withPin?: string) {
    setError(null);
    setPending(true);
    try {
      const body: Record<string, unknown> = { code };
      const deviceToken = getDeviceToken();
      if (deviceToken) body.deviceToken = deviceToken;
      if (withPin) {
        body.pin = withPin;
        body.rememberDevice = rememberDevice;
      }
      const result = await studentFetch("/student/login", body);
      if (result.ok && result.sessionToken) {
        setSession({
          sessionToken: result.sessionToken,
          deviceToken: result.deviceToken,
        });
        if (result.needsPinSetup) {
          setPending(false);
          setStep("pinSetup");
          return;
        }
        router.replace("/portal");
        return;
      }
      if (result.needsPin) {
        setPending(false);
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

  async function submitPinSetup() {
    setError(null);
    setPending(true);
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
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submitLogin();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">{t("auth.accessCode")}</Label>
                <Input
                  id="code"
                  dir="ltr"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                  placeholder={t("auth.accessCodePlaceholder")}
                  className="h-11 text-center font-mono text-base tracking-wider uppercase"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={pending || code.length < 8}>
                {pending ? <Spinner /> : null}
                {t("auth.signIn")}
              </Button>
            </form>
          ) : null}

          {step === "pin" ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submitLogin(pin);
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="pin">{t("auth.pin")}</Label>
                <Input
                  id="pin"
                  dir="ltr"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  minLength={4}
                  maxLength={6}
                  className="h-11 text-center font-mono text-lg tracking-[0.5em]"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={rememberDevice}
                  onCheckedChange={(v) => setRememberDevice(v === true)}
                />
                {t("auth.rememberDevice")}
              </label>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={pending || pin.length < 4}>
                {pending ? <Spinner /> : null}
                {t("auth.signIn")}
              </Button>
            </form>
          ) : null}

          {step === "pinSetup" ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submitPinSetup();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="setupPin">{t("auth.pin")}</Label>
                <Input
                  id="setupPin"
                  dir="ltr"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  minLength={4}
                  maxLength={6}
                  className="h-11 text-center font-mono text-lg tracking-[0.5em]"
                  value={setupPin}
                  onChange={(e) =>
                    setSetupPin(e.target.value.replace(/\D/g, ""))
                  }
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={pending || setupPin.length < 4}
                >
                  {pending ? <Spinner /> : null}
                  {t("common.save")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => router.replace("/portal")}
                >
                  {t("auth.pinSkip")}
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
