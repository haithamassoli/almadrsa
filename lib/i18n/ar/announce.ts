// M5 announcements strings — owned by the staff-m5 feature.
export const announce = {
  title: "الإعلانات",
  newAnnouncement: "إعلان جديد",

  // Dialog
  dialogTitle: "إعلان جديد",
  scopeLabel: "النطاق",
  scopeSchool: "المدرسة كلها",
  scopeClass: "فصل محدد",
  classLabel: "الفصل",
  selectClass: "اختر الفصل",
  titleLabel: "العنوان",
  titlePlaceholder: "عنوان الإعلان",
  bodyLabel: "النص",
  bodyPlaceholder: "اكتب نص الإعلان…",
  publish: "نشر",
  created: "نُشر الإعلان",

  // Badges
  badgeSchool: "المدرسة",

  // List
  deleteAnnouncement: "حذف الإعلان",
  deleted: "حُذف الإعلان",
  deleteTitle: "حذف الإعلان",
  deleteConfirm: "هل تريد حذف هذا الإعلان؟ لا يمكن التراجع عن هذا الإجراء.",

  // Empty state
  emptyTitle: "لا إعلانات بعد",
  emptyBody: "لم يُنشَر أي إعلان. أنشئ أول إعلان لطلابك.",

  // Errors
  errInvalidAnnouncement: "بيانات الإعلان غير صالحة.",
  errNotOwner: "لا يمكنك حذف إعلانًا نشره غيرك.",
  errNotAssigned: "لست مُسندًا إلى هذا الفصل.",
  errNotFound: "الإعلان غير موجود.",
} as const;
