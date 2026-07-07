"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

const DISMISSED_KEY = "pushUi.optInDismissed";
// A dismissal snoozes the banner; it may come back after two weeks.
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// The VAPID PUBLIC key — safe by design to ship to every browser (the
// private half lives only in Convex deployment env vars).
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** Web Push applicationServerKey wants raw bytes, env holds base64url. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function isSnoozed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

// Static browser-environment read, exposed through useSyncExternalStore so
// SSR/hydration render the safe value (hidden) and the client pass corrects it.
const emptySubscribe = () => () => {};

function canOfferPush(): boolean {
  return Boolean(
    VAPID_PUBLIC_KEY &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      Notification.permission !== "denied" &&
      !isSnoozed(),
  );
}

/**
 * Portal-only push opt-in banner. Shows when a service worker is registered
 * (production builds only — `next dev` never registers one, see
 * next.config.ts), push is supported, permission isn't denied and the browser
 * isn't subscribed yet. If a subscription already exists it is silently
 * re-synced to the server, which reassigns the row when a shared family
 * device switches students.
 */
export function PushSubscribe() {
  const { sessionToken, ready } = useStudentSession();
  const subscribeMutation = useMutation(api.push.subscribe);
  const offerable = useSyncExternalStore(
    emptySubscribe,
    canOfferPush,
    () => false,
  );

  // null = probing; false = unavailable/already handled; true = show banner.
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!ready || !sessionToken || !offerable) return;
    let cancelled = false;
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        // No service worker (e.g. dev server) — push can't work here.
        if (!cancelled) setEligible(false);
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      if (cancelled) return;
      if (subscription) {
        setEligible(false);
        // Already subscribed in this browser: re-sync so the row follows the
        // signed-in student (shared-device reassign). Fire-and-forget.
        const json = subscription.toJSON();
        if (json.keys?.p256dh && json.keys.auth) {
          subscribeMutation({
            sessionToken,
            endpoint: subscription.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            userAgent: navigator.userAgent,
          }).catch(() => {});
        }
        return;
      }
      setEligible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, sessionToken, offerable, subscribeMutation]);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — the banner still hides for this session.
    }
    setDismissed(true);
  }

  async function enable() {
    if (!sessionToken) return;
    setPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        // The user said no in the browser prompt — snooze our banner too.
        dismiss();
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      });
      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys.auth) {
        throw new Error("subscription missing keys");
      }
      await subscribeMutation({
        sessionToken,
        endpoint: subscription.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent,
      });
      toast.success(t("pushUi.enabledToast"));
      setEligible(false);
    } catch {
      toast.error(t("pushUi.errorToast"));
    } finally {
      setPending(false);
    }
  }

  if (!offerable || eligible !== true || dismissed) return null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-3">
      <Card size="sm" className="flex-row items-center gap-3 border px-3">
        <BellRing className="size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-bold">{t("pushUi.enableTitle")}</span>
          <span className="text-xs text-muted-foreground">
            {t("pushUi.enableBody")}
          </span>
        </div>
        <Button size="sm" disabled={pending} onClick={() => void enable()}>
          {pending ? <Spinner /> : null}
          {t("pushUi.enableAction")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("pushUi.dismiss")}
          onClick={dismiss}
        >
          <X aria-hidden />
        </Button>
      </Card>
    </div>
  );
}
