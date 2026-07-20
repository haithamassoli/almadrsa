export const portal = {
  navHome: "الرئيسية",
  navExams: "الاختبارات",
  navHomework: "الواجبات",
  navAttendance: "الحضور",
  navAnnouncements: "الإعلانات",
  navNotifications: "الإشعارات",
  unreadCount: "{count} إشعارات غير مقروءة",
  greeting: "أهلًا، {name}",
  subtitle: "بوابة الطالب وولي الأمر",
  soonTitle: "بوابتك قيد الإعداد",
  soonBody: "ستظهر هنا موادّك ودرجاتك ومستجدّاتك فور تفعيلها من المدرسة.",

  // M5 — home
  todayTitle: "حصص اليوم",
  todayEmpty: "لا حصص اليوم",
  periodN: "الحصة {n}",
  statusPresent: "حاضر",
  statusLate: "متأخر",
  statusAbsent: "غائب",
  statusNotMarked: "لم يُسجَّل بعد",
  resultsTitle: "آخر النتائج",
  resultsEmpty: "لا نتائج بعد",
  scoreFraction: "{score}/{total}",
  attendanceSummaryTitle: "الحضور (آخر 30 يومًا)",
  attendanceRate: "نسبة الحضور",
  attendanceViewAll: "عرض السجل كاملًا",
  notesTitle: "ملاحظات المعلّمين",
  announcementsTitle: "الإعلانات",
  announcementsViewAll: "عرض كل الإعلانات",

  // M5 — attendance history
  attendanceHistoryTitle: "سجل الحضور",
  from: "من",
  to: "إلى",
  colDate: "التاريخ",
  colPeriod: "الحصة",
  colSubject: "المادة",
  colStatus: "الحالة",
  attendanceEmptyTitle: "لا سجلات حضور",
  attendanceEmptyBody: "لا توجد سجلات حضور ضمن النطاق المحدَّد.",

  // M5 — notifications
  notificationsTitle: "الإشعارات",
  markAllRead: "تحديد الكل مقروءًا",
  markAllReadDone: "تم تحديد الكل مقروءًا",
  notificationsEmptyTitle: "لا إشعارات",
  notificationsEmptyBody:
    "ستصلك هنا إشعارات الاختبارات والنتائج والإعلانات والملاحظات.",

  // M5 — announcements
  scopeSchool: "المدرسة",
  announcementsEmptyTitle: "لا إعلانات بعد",
  announcementsEmptyBody: "حين تنشر المدرسة أو معلّموك إعلانًا سيظهر هنا.",

  // M5 — exam result: class comparison
  compareTitle: "مقارنة بالفصل",
  compareYou: "درجتك",
  compareAvg: "متوسط الفصل",
  compareMax: "أعلى درجة",

  // Error codes
  errNotFound: "المحتوى المطلوب غير موجود.",

  // M16 — device-local multi-child account switcher
  switchStudent: "تبديل الطالب",
  addStudent: "إضافة طالب آخر",
  sessionExpiredSwitched: "انتهت جلسة الطالب السابق، تم التبديل إلى حساب آخر",
} as const;
