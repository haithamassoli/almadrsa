"use client";

import { useEffect, useState } from "react";

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
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
  // Keep the device token: "remember this device" survives logout.
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

// `ready` flips after mount so SSR markup never depends on localStorage.
export function useStudentSession(): {
  sessionToken: string | null;
  ready: boolean;
} {
  const [state, setState] = useState<{
    sessionToken: string | null;
    ready: boolean;
  }>({ sessionToken: null, ready: false });
  useEffect(() => {
    setState({ sessionToken: getSessionToken(), ready: true });
  }, []);
  return state;
}
