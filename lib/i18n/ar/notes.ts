// M5 teacher notes strings — owned by the staff-m5 feature.
export const notes = {
  title: "ملاحظات الطلاب",

  // Pickers
  classLabel: "الفصل",
  selectClass: "اختر الفصل",
  studentLabel: "الطالب",
  selectStudent: "اختر الطالب",

  // Composer
  composerTitle: "إضافة ملاحظة",
  composerPlaceholder: "اكتب ملاحظة عن الطالب…",
  addNote: "إضافة ملاحظة",
  created: "أُضيفت الملاحظة",

  // List
  deleteNote: "حذف الملاحظة",
  deleted: "حُذفت الملاحظة",
  deleteTitle: "حذف الملاحظة",
  deleteConfirm: "هل تريد حذف هذه الملاحظة؟ لا يمكن التراجع عن هذا الإجراء.",

  // Empty states
  pickClassTitle: "اختر فصلًا",
  pickClassBody: "اختر فصلًا من القائمة ثم طالبًا لعرض ملاحظاته.",
  pickStudentTitle: "اختر طالبًا",
  pickStudentBody: "اختر طالبًا من الفصل لعرض ملاحظاته وإضافة ملاحظة جديدة.",
  noNotesTitle: "لا ملاحظات بعد",
  noNotesBody: "لم تُسجَّل أي ملاحظة لهذا الطالب. أضِف أول ملاحظة من الأعلى.",

  // Errors
  errInvalidNote: "نص الملاحظة غير صالح.",
  errNotOwner: "لا يمكنك حذف ملاحظة كتبها غيرك.",
  errNotFound: "الملاحظة غير موجودة.",
} as const;
