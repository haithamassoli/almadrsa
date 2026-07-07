// M14 calendar strings — owned by the calendar feature. Covers the shared
// month grid (nav, weekday header, legend), the staff calendars
// (/teacher/calendar, /admin/calendar + event dialog) and /portal/calendar.
export const calendarUi = {
  title: "التقويم",

  // Month navigation
  prevMonth: "الشهر السابق",
  nextMonth: "الشهر التالي",

  // Weekday header (Sunday-first)
  weekdaySun: "الأحد",
  weekdayMon: "الاثنين",
  weekdayTue: "الثلاثاء",
  weekdayWed: "الأربعاء",
  weekdayThu: "الخميس",
  weekdayFri: "الجمعة",
  weekdaySat: "السبت",

  // Item kinds (legend + day-list badges)
  kindLesson: "حصة",
  kindExam: "اختبار",
  kindHomework: "واجب",
  kindHoliday: "عطلة",
  kindEvent: "فعالية",

  // Selected-day panel
  dayEmpty: "لا توجد عناصر في هذا اليوم.",
  pickDayHint: "اختر يومًا من الشبكة لعرض تفاصيله.",
  openItem: "فتح {title}",

  // Staff: class picker
  classLabel: "الفصل",
  selectClass: "اختر الفصل",
  pickClassTitle: "اختر فصلًا",
  pickClassBody:
    "اختر فصلًا لعرض تقويمه الشهري: الحصص والاختبارات والواجبات والفعاليات.",

  // Admin: event management
  addEvent: "إضافة عطلة/فعالية",
  eventTitleLabel: "العنوان",
  eventKindLabel: "النوع",
  eventDateLabel: "التاريخ",
  eventEndDateLabel: "تاريخ الانتهاء (اختياري)",
  eventScopeLabel: "النطاق",
  scopeSchool: "عموم المدرسة",
  eventCreated: "أُضيفت إلى التقويم",
  eventDeleted: "حُذفت من التقويم",
  deleteEventAria: "حذف {title}",
  deleteEventTitle: "حذف من التقويم",
  deleteEventConfirm: "سيُحذف «{title}» من التقويم نهائيًا. هل أنت متأكد؟",

  // Backend error codes
  errInvalidEvent: "بيانات غير صالحة. تحقَّق من العنوان والتاريخين.",
  errNotFound: "العنصر المطلوب غير موجود.",
} as const;
