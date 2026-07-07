"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";

const DISMISSED_KEY = "pwa.installPromptDismissed";
// A dismissal snoozes the banner; it may come back after two weeks.
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Chromium-only event; not in TS's DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

// Static browser-environment reads, exposed through useSyncExternalStore so
// SSR/hydration render the safe value (hidden) and the client pass corrects it.
const emptySubscribe = () => () => {};

function isSnoozed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    // Storage unavailable — behave as if never dismissed.
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosBrowser(): boolean {
  return /iphone|ipad/i.test(navigator.userAgent);
}

/**
 * Portal-only install banner. Android/desktop Chromium: captures
 * `beforeinstallprompt` and offers a real install button. iOS Safari: shows
 * the add-to-home-screen hint (iOS has no install prompt API). Hidden when
 * already running standalone and while snoozed after a dismissal.
 */
export function InstallPrompt() {
  const standalone = useSyncExternalStore(
    emptySubscribe,
    isStandalone,
    () => true,
  );
  const snoozedAtLoad = useSyncExternalStore(
    emptySubscribe,
    isSnoozed,
    () => true,
  );
  const isIos = useSyncExternalStore(emptySubscribe, isIosBrowser, () => false);

  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Keep the event so our own button can trigger the native prompt.
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — the banner still hides for this session.
    }
    setDismissed(true);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "dismissed") {
      dismiss();
    } else {
      setInstallEvent(null);
    }
  }

  if (standalone || snoozedAtLoad || dismissed) return null;
  if (!installEvent && !isIos) return null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-3">
      <Card size="sm" className="flex-row items-center gap-3 border px-3">
        {isIos ? (
          <>
            <Share className="size-4 shrink-0 text-primary" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-bold">{t("pwa.installTitle")}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {t("pwa.installIosHint")}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-bold">{t("pwa.installTitle")}</span>
              <span className="text-xs text-muted-foreground">
                {t("pwa.installBody")}
              </span>
            </div>
            <Button size="sm" onClick={() => void install()}>
              {t("pwa.installAction")}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("pwa.dismiss")}
          onClick={dismiss}
        >
          <X aria-hidden />
        </Button>
      </Card>
    </div>
  );
}
