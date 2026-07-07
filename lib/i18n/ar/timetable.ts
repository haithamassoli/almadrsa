// M3 admin timetable strings — owned by the admin-timetable feature.
export const timetable = {
  title: "الجدول الدراسي",
  classLabel: "الفصل",
  period: "الحصة",

  // Week columns (Sunday–Thursday, weekday 0–4).
  sunday: "الأحد",
  monday: "الاثنين",
  tuesday: "الثلاثاء",
  wednesday: "الأربعاء",
  thursday: "الخميس",

  addSlot: "إضافة حصة",
  editSlot: "تعديل الحصة",
  subject: "المادة",
  teacher: "المعلّم",
  selectSubject: "اختر المادة",
  selectTeacher: "اختر المعلّم",
  noSubjects: "لا توجد مواد لهذا الفصل. أضف المواد من الهيكل الأكاديمي.",

  deleteSlot: "حذف الحصة",
  deleteTitle: "حذف الحصة",
  deleteConfirm: "سيُحذف هذا الموعد من جدول الفصل. هل تريد المتابعة؟",

  saved: "تم حفظ الحصة",
  deleted: "تم حذف الحصة",

  // Empty state — no classes yet.
  noClassesTitle: "لا توجد فصول بعد",
  noClassesHint:
    "أنشئ الصفوف والفصول أولاً من الهيكل الأكاديمي، ثم عُد لبناء الجدول.",
  noClassesCta: "الذهاب إلى الهيكل الأكاديمي",

  // Domain error codes → Arabic messages.
  errTeacherBusy: "المعلّم لديه حصة أخرى في هذا الوقت",
  errSubjectGradeMismatch: "المادة لا تتبع صفّ هذا الفصل",
  errNotFound: "لم يُعثر على الحصة",
} as const;
