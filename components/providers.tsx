"use client";

import type { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth-client";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({
  children,
  initialToken,
}: {
  children: ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ConvexBetterAuthProvider
        client={convex}
        // adminClient() widens the inferred client type beyond the provider's
        // AuthClient union; runtime shape is compatible.
        authClient={authClient as unknown as AuthClient}
        initialToken={initialToken}
      >
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-center" dir="rtl" />
      </ConvexBetterAuthProvider>
    </ThemeProvider>
  );
}
