"use client";

import { useSyncExternalStore } from "react";

// Student/parent session tokens live in localStorage (the portal is fully
// client-rendered; every Convex query re-validates the token server-side).
const SESSION_KEY = "student.session";
const DEVICE_KEY = "student.device";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(DEVICE_KEY);
}

export function setSession(tokens: {
  sessionToken: string;
  deviceToken?: string;
}): void {
  window.localStorage.setItem(SESSION_KEY, tokens.sessionToken);
  if (tokens.deviceToken) {
    window.localStorage.setItem(DEVICE_KEY, tokens.deviceToken);
  }
  emit();
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
  // Keep the device token: "remember this device" survives logout.
  emit();
}

export type StudentLoginResponse = {
  ok: boolean;
  sessionToken?: string;
  deviceToken?: string;
  needsPinSetup?: boolean;
  needsPin?: boolean;
  error?: string;
  student?: { firstName: string; lastName: string };
};

export async function studentFetch(
  path: string,
  body: Record<string, unknown>,
): Promise<StudentLoginResponse> {
  const base = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as StudentLoginResponse;
}

// ——— Reactive subscription for the portal shell ———
// The browser `storage` event only fires across tabs; `emit` covers same-tab
// setSession/clearSession so subscribers react without a remount.
const listeners = new Set<() => void>();
function emit(): void {
  for (const listener of listeners) listener();
}
function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Reactive session token. `ready` is false during SSR and the hydration pass
 * (localStorage isn't readable yet) and flips true once on the client, so the
 * portal never redirects before it has actually checked for a token.
 */
export function useStudentSession(): {
  sessionToken: string | null;
  ready: boolean;
} {
  const sessionToken = useSyncExternalStore(
    subscribe,
    getSessionToken,
    () => null,
  );
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return { sessionToken, ready };
}
