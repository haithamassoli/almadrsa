"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/i18n";
import { mutationErrorText } from "./errors";

/**
 * M15 — admin settings. First card: the external guardian-message channels
 * (WhatsApp/SMS) delivered through a provider webhook bridge
 * (api.admin.channelsConfig / saveChannelsConfig).
 */
export default function SettingsPage() {
  const config = useQuery(api.admin.channelsConfig, {});

  return (
    <div className="flex flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("settingsUi.title")}
      </h1>

      {config === undefined ? (
        <Skeleton className="h-64 max-w-2xl rounded-2xl" />
      ) : (
        <ChannelsCard config={config} />
      )}
    </div>
  );
}

/**
 * Channels card, mounted once the stored config is loaded so the form state
 * initializes from it (edits are local until saved).
 */
function ChannelsCard({
  config,
}: {
  config: { webhookEnabled: boolean; webhookUrl?: string };
}) {
  const saveConfig = useMutation(api.admin.saveChannelsConfig);
  const [enabled, setEnabled] = useState(config.webhookEnabled);
  const [url, setUrl] = useState(config.webhookUrl ?? "");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      // An emptied URL is cleared; a stored URL survives toggling off.
      await saveConfig({
        webhookEnabled: enabled,
        webhookUrl: url.trim() === "" ? undefined : url.trim(),
      });
      toast.success(t("settingsUi.channelsSaved"));
    } catch (error) {
      toast.error(mutationErrorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="max-w-2xl rounded-2xl">
      <CardHeader>
        <CardTitle>{t("settingsUi.channelsTitle")}</CardTitle>
        <CardDescription>{t("settingsUi.channelsExplainer")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <Label htmlFor="channels-enabled">
              {t("settingsUi.webhookEnabledLabel")}
            </Label>
            <Switch
              id="channels-enabled"
              checked={enabled}
              onCheckedChange={(checked) => setEnabled(checked)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="channels-url">
              {t("settingsUi.webhookUrlLabel")}
            </Label>
            <Input
              id="channels-url"
              type="url"
              dir="ltr"
              placeholder={t("settingsUi.webhookUrlPlaceholder")}
              maxLength={2048}
              required={enabled}
              pattern="https://.*"
              disabled={!enabled}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
