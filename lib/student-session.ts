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
  studentId?: string;
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

// ——— Device-local multi-child accounts (M16) ———
// ponytail: accounts live only in this browser's localStorage — they do not
// roam across devices. Server-side family grouping is the upgrade path.
const ACCOUNTS_KEY = "student.accounts";

export type StoredAccount = {
  studentId: string; // students table id; "" until backfilled from `me`
  name: string; // display name for the switcher; "" until backfilled
  sessionToken: string;
};

const EMPTY_ACCOUNTS: StoredAccount[] = [];

// Parse the stored accounts list, tolerating malformed/legacy JSON by keeping
// only well-formed, minimal `{studentId, name, sessionToken}` entries.
function parseAccounts(raw: string): StoredAccount[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_ACCOUNTS;
    const accounts: StoredAccount[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { sessionToken?: unknown }).sessionToken ===
          "string" &&
        (entry as { sessionToken: string }).sessionToken !== ""
      ) {
        const e = entry as Partial<StoredAccount>;
        accounts.push({
          studentId: typeof e.studentId === "string" ? e.studentId : "",
          name: typeof e.name === "string" ? e.name : "",
          sessionToken: e.sessionToken as string,
        });
      }
    }
    return accounts;
  } catch {
    return EMPTY_ACCOUNTS;
  }
}

function persistAccounts(accounts: StoredAccount[]): void {
  window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

// Read the accounts list from storage. Migration: a pre-switcher device has an
// active session but no accounts list — synthesize a single-entry list from it
// and persist so an already-logged-in device upgrades seamlessly.
function readAccountsFresh(): {
  raw: string | null;
  accounts: StoredAccount[];
} {
  const raw = window.localStorage.getItem(ACCOUNTS_KEY);
  if (raw !== null) return { raw, accounts: parseAccounts(raw) };
  const token = window.localStorage.getItem(SESSION_KEY);
  if (token) {
    const migrated: StoredAccount[] = [
      { studentId: "", name: "", sessionToken: token },
    ];
    const serialized = JSON.stringify(migrated);
    window.localStorage.setItem(ACCOUNTS_KEY, serialized);
    return { raw: serialized, accounts: migrated };
  }
  return { raw: null, accounts: EMPTY_ACCOUNTS };
}

export function listAccounts(): StoredAccount[] {
  if (typeof window === "undefined") return EMPTY_ACCOUNTS;
  return readAccountsFresh().accounts;
}

// Upsert an account (dedupe by studentId when known, else by sessionToken),
// then make it the active session.
export function addAccount(account: StoredAccount): void {
  if (typeof window === "undefined") return;
  const next = listAccounts().filter(
    (a) =>
      a.sessionToken !== account.sessionToken &&
      !(account.studentId !== "" && a.studentId === account.studentId),
  );
  next.push(account);
  persistAccounts(next);
  window.localStorage.setItem(SESSION_KEY, account.sessionToken);
  emit();
}

export function switchAccount(studentId: string): void {
  if (typeof window === "undefined") return;
  const account = listAccounts().find((a) => a.studentId === studentId);
  if (!account) return;
  window.localStorage.setItem(SESSION_KEY, account.sessionToken);
  emit();
}

// Remove the active account and promote the next one, or clear the session when
// none remain. Returns the promoted account, or null when the list is now empty.
export function removeActiveAccount(): StoredAccount | null {
  if (typeof window === "undefined") return null;
  const activeToken = window.localStorage.getItem(SESSION_KEY);
  const remaining = listAccounts().filter((a) => a.sessionToken !== activeToken);
  persistAccounts(remaining);
  if (remaining.length > 0) {
    window.localStorage.setItem(SESSION_KEY, remaining[0].sessionToken);
    emit();
    return remaining[0];
  }
  // No accounts left: drop the active session but keep the device token, exactly
  // like clearSession ("remember this device" survives sign-out).
  window.localStorage.removeItem(SESSION_KEY);
  emit();
  return null;
}

// Repair a migrated/stale entry once `me` resolves. No-op when nothing changed
// so the [me] effect can't loop.
export function backfillActiveAccount(patch: {
  studentId: string;
  name: string;
}): void {
  if (typeof window === "undefined") return;
  const activeToken = window.localStorage.getItem(SESSION_KEY);
  if (!activeToken) return;
  const accounts = listAccounts();
  const idx = accounts.findIndex((a) => a.sessionToken === activeToken);
  if (idx === -1) return;
  const current = accounts[idx];
  if (current.studentId === patch.studentId && current.name === patch.name) {
    return;
  }
  const next = accounts.slice();
  next[idx] = {
    studentId: patch.studentId,
    name: patch.name,
    sessionToken: current.sessionToken,
  };
  persistAccounts(next);
  emit();
}

// Referentially-stable snapshot for useSyncExternalStore: while the raw JSON
// string in localStorage is unchanged, return the SAME array instance, or React
// throws "getSnapshot should be cached" and loops.
let accountsCacheRaw: string | null | undefined;
let accountsCache: StoredAccount[] = EMPTY_ACCOUNTS;
function getCachedAccounts(): StoredAccount[] {
  if (typeof window === "undefined") return EMPTY_ACCOUNTS;
  const raw = window.localStorage.getItem(ACCOUNTS_KEY);
  if (raw === accountsCacheRaw) return accountsCache;
  const fresh = readAccountsFresh();
  accountsCacheRaw = fresh.raw;
  accountsCache = fresh.accounts;
  return accountsCache;
}

export function useStudentAccounts(): StoredAccount[] {
  return useSyncExternalStore(subscribe, getCachedAccounts, () => EMPTY_ACCOUNTS);
}
