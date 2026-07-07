// M15 admin settings strings — owned by the settings feature.
export const settingsUi = {
  title: "الإعدادات",

  // External channels card (WhatsApp / SMS bridge webhook)
  channelsTitle: "قنوات خارجية (واتساب/رسائل SMS)",
  channelsExplainer:
    "تُرسل الإشعارات إلى جسر خارجي يتولى التوصيل — أدخل رابط الويبهوك الخاص بمزوّدك.",
  webhookEnabledLabel: "تفعيل الإرسال عبر الويبهوك",
  webhookUrlLabel: "رابط الويبهوك",
  webhookUrlPlaceholder: "https://example.com/hook",
  channelsSaved: "حُفظت إعدادات القنوات.",

  // Backend error codes
  errInvalidConfig:
    "الإعدادات غير صالحة. عند تفعيل الإرسال أدخل رابط ويبهوك يبدأ بـ https://",
} as const;
