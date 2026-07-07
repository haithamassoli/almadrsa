// M3 teacher lessons/today strings — owned by the teacher-lessons feature.
export const lessons = {
  // Today dashboard
  addAdhoc: "حصة إضافية",
  periodBadge: "الحصة {period}",
  adhocBadge: "إضافية",
  attendanceProgress: "الحضور {marked}/{enrolled}",
  attendanceNotMarked: "لم يُسجَّل الحضور",
  emptyTodayTitle: "لا توجد حصص اليوم",
  emptyTodayBody: "جدول اليوم خالٍ. أضف حصة إضافية إذا كنت ستدرّس خارج الجدول.",
  openLesson: "فتح الحصة {subject} — {class}",

  // Ad-hoc lesson dialog
  adhocDialogTitle: "إضافة حصة إضافية",
  classLabel: "الفصل",
  subjectLabel: "المادة",
  dateLabel: "التاريخ",
  periodLabel: "رقم الحصة",
  titleLabel: "عنوان الحصة (اختياري)",
  choosePlaceholder: "اختر…",
  adhocCreated: "أُضيفت الحصة",

  // Lesson page
  backToToday: "العودة إلى حصص اليوم",
  notFoundTitle: "الحصة غير موجودة",
  notFoundBody: "ربما حُذفت الحصة أو لا تملك صلاحية عرضها.",

  // Attendance card
  attendanceTitle: "تسجيل الحضور",
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
  markAllPresent: "تحديد الجميع حاضرًا",
  unsavedChanges: "تغييرات غير محفوظة: {count}",
  saveAttendance: "حفظ الحضور",
  attendanceSaved: "تم حفظ الحضور",
  rosterEmpty: "لا يوجد طلاب نشطون في هذا الفصل",
  attendanceOf: "حالة حضور {name}",

  // Resources card
  resourcesTitle: "المصادر",
  addResource: "إضافة مصدر",
  resourceTitleLabel: "العنوان",
  resourceUrlLabel: "الرابط",
  resourceAdded: "أُضيف المصدر",
  resourceRemoved: "حُذف المصدر",
  removeResource: "حذف المصدر",
  resourcesEmpty: "لا مصادر لهذه الحصة بعد.",

  // Notes card
  notesTitle: "ملاحظات الحصة",
  notesPlaceholder: "اكتب ملاحظاتك عن هذه الحصة…",
  saveNotes: "حفظ الملاحظات",
  notesSaved: "تم حفظ الملاحظات",

  // Backend error codes
  errNotFound: "الحصة غير موجودة",
  errInvalidDate: "التاريخ غير صالح",
  errInvalidPeriod: "رقم الحصة غير صالح",
  errNotAssigned: "لست معيّنًا لهذه المادة في هذا الفصل",
  errTooManyResources: "لا يمكن إضافة أكثر من 10 مصادر",
  errInvalidUrl: "الرابط غير صالح — يجب أن يبدأ بـ https://",
  errLessonHasAttendance: "لا يمكن حذف حصة سُجّل لها حضور",
  errTooManyEntries: "عدد سجلات الحضور أكبر من المسموح",
} as const;
