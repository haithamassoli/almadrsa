"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { LogoMark } from "@/components/app-shell/logo-mark";
import { useAppForm } from "@/components/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  // Failed sign-in is a server response, not field validation — kept local
  // and shown above the submit button.
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: {
      onSubmit: z.object({
        email: z
          .string()
          .min(1, t("common.requiredField"))
          .email(t("common.invalidValue")),
        password: z.string().min(1, t("common.requiredField")),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const result = await authClient.signIn.email({
          email: value.email,
          password: value.password,
        });
        if (result.error) {
          setError(t("auth.invalidCredentials"));
          return;
        }
        // Read the role straight off the fresh session; the shell guard is the
        // real gate (it bounces a wrong-area landing), so this only picks the
        // starting screen. isSubmitting stays true until the navigation below
        // unmounts the form.
        const session = await authClient.getSession();
        const role = session.data?.user
          ? (session.data.user as { role?: string }).role
          : undefined;
        const home = role === "admin" ? "/admin" : "/teacher";
        router.replace(safeRedirect(searchParams.get("redirect")) ?? home);
      } catch {
        setError(t("common.errorGeneric"));
      }
    },
  });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <LogoMark className="mx-auto mb-2 size-12" />
        <CardTitle className="text-xl">{t("auth.staffLogin")}</CardTitle>
        <CardDescription>{t("auth.loginRequired")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                label={t("auth.email")}
                type="email"
                dir="ltr"
                autoComplete="email"
              />
            )}
          </form.AppField>
          <form.AppField name="password">
            {(field) => (
              <field.TextField
                label={t("auth.password")}
                type="password"
                dir="ltr"
                autoComplete="current-password"
              />
            )}
          </form.AppField>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <form.AppForm>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <form.SubmitButton>
                  {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
                </form.SubmitButton>
              )}
            </form.Subscribe>
          </form.AppForm>
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
