// Portal (student/parent) messaging strings — the thread list, the empty
// state, and the home shortcut card. The conversation itself (message bubbles,
// composer) lives in the shared ThreadView component and uses `messagesUi`.
export const messagesPortal = {
  title: "الرسائل",
  // Thread list
  back: "رجوع",
  unreadCount: "{count} غير مقروءة",
  // Empty state — students can't start threads in v1 (teacher-initiated only).
  emptyTitle: "لا رسائل بعد",
  emptyHint: "يبدأ المعلّم المحادثة وستظهر هنا.",
  // Home shortcut card (sits next to the reports card).
  homeCardTitle: "الرسائل",
  homeCardBody: "محادثاتك مع المعلّمين",
} as const;
