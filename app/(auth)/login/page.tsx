"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GraduationCap } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

/**
 * Only same-origin absolute paths are honored for `?redirect=`. Rejecting
 * `//host` and `/\host` closes the open-redirect vector a bare
 * `startsWith("/")` check would leave open.
 */
function safeRedirect(value: string | null): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(t("auth.invalidCredentials"));
        setPending(false);
        return;
      }
      // Read the role straight off the fresh session; the shell guard is the
      // real gate (it bounces a wrong-area landing), so this only picks the
      // starting screen. Keep pending true — the navigation unmounts the form.
      const session = await authClient.getSession();
      const role = session.data?.user
        ? (session.data.user as { role?: string }).role
        : undefined;
      const home = role === "admin" ? "/admin" : "/teacher";
      router.replace(safeRedirect(searchParams.get("redirect")) ?? home);
    } catch {
      setError(t("common.errorGeneric"));
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <GraduationCap className="size-6" aria-hidden />
        </div>
        <CardTitle className="text-xl">{t("auth.staffLogin")}</CardTitle>
        <CardDescription>{t("auth.loginRequired")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Suspense
        fallback={<Spinner className="size-6 text-muted-foreground" />}
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
