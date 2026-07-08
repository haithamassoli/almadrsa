"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { useAppForm } from "@/components/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

  const form = useAppForm({
    defaultValues: {
      webhookEnabled: config.webhookEnabled,
      webhookUrl: config.webhookUrl ?? "",
    },
    validators: {
      // When the webhook is enabled the URL is required and must be https;
      // when it's off the field is disabled and its value is ignored.
      onSubmit: z
        .object({
          webhookEnabled: z.boolean(),
          webhookUrl: z.string().trim(),
        })
        .refine((v) => !v.webhookEnabled || v.webhookUrl.length > 0, {
          message: t("common.requiredField"),
          path: ["webhookUrl"],
        })
        .refine((v) => !v.webhookEnabled || /^https:\/\//.test(v.webhookUrl), {
          message: t("common.invalidValue"),
          path: ["webhookUrl"],
        }),
    },
    onSubmit: async ({ value }) => {
      try {
        // An emptied URL is cleared; a stored URL survives toggling off.
        const url = value.webhookUrl.trim();
        await saveConfig({
          webhookEnabled: value.webhookEnabled,
          webhookUrl: url === "" ? undefined : url,
        });
        toast.success(t("settingsUi.channelsSaved"));
      } catch (error) {
        toast.error(mutationErrorText(error));
      }
    },
  });

  return (
    <Card className="max-w-2xl rounded-2xl">
      <CardHeader>
        <CardTitle>{t("settingsUi.channelsTitle")}</CardTitle>
        <CardDescription>{t("settingsUi.channelsExplainer")}</CardDescription>
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
          <form.AppField name="webhookEnabled">
            {(field) => (
              <field.SwitchField label={t("settingsUi.webhookEnabledLabel")} />
            )}
          </form.AppField>
          {/* URL is only editable while the webhook is enabled. */}
          <form.Subscribe selector={(s) => s.values.webhookEnabled}>
            {(enabled) => (
              <form.AppField name="webhookUrl">
                {(field) => (
                  <field.TextField
                    label={t("settingsUi.webhookUrlLabel")}
                    type="url"
                    dir="ltr"
                    placeholder={t("settingsUi.webhookUrlPlaceholder")}
                    maxLength={2048}
                    disabled={!enabled}
                  />
                )}
              </form.AppField>
            )}
          </form.Subscribe>
          <div className="flex justify-end">
            <form.AppForm>
              <form.SubmitButton>{t("common.save")}</form.SubmitButton>
            </form.AppForm>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
