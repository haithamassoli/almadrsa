// M13 messaging strings (staff page + shared thread view) — owned by the
// staff-m13 feature.
export const messagesUi = {
  title: "الرسائل",

  // Thread list
  newThread: "محادثة جديدة",
  unreadCount: "{count} رسالة غير مقروءة",
  selectThreadBody: "اختر محادثة من القائمة لعرض الرسائل.",
  emptyTitle: "لا محادثات بعد",
  emptyBody: "ابدأ محادثة مع ولي أمر أحد طلابك من زر «محادثة جديدة».",

  // New-conversation dialog
  classLabel: "الفصل",
  selectClass: "اختر الفصل",
  studentLabel: "الطالب",
  selectStudent: "اختر الطالب",
  startConversation: "فتح المحادثة",

  // Conversation (shared thread view)
  conversation: "المحادثة",
  emptyThread: "ابدأ المحادثة…",
  composerLabel: "نص الرسالة",
  composerPlaceholder: "اكتب رسالتك…",
  send: "إرسال",

  // Errors
  errInvalidMessage: "نص الرسالة غير صالح — يجب ألا يتجاوز 2000 حرف.",
  errNotFound: "المحادثة غير موجودة.",
} as const;
