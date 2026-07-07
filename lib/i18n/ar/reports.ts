// M11 report cards strings — owned by the reports feature.
export const reports = {
  // Admin publish screen
  title: "التقارير",
  termLabel: "الفصل الدراسي",
  selectTerm: "اختر الفصل الدراسي",
  classLabel: "الشعبة",
  selectClass: "اختر الشعبة",
  pickPrompt: "اختر شعبةً وفصلًا دراسيًا لعرض تقارير الطلاب.",
  generate: "توليد التقارير",
  generateTitle: "توليد تقارير الشعبة",
  generateConfirm:
    "يعيد التوليد حساب المسودات فقط من الدرجات والحضور الحاليين، ولا يمسّ التقارير المنشورة. متابعة؟",
  generateStarted: "بدأ توليد {count} تقريرًا — تظهر النتائج تباعًا",
  publishAll: "نشر الكل",
  publishAllTitle: "نشر كل المسودات",
  publishAllConfirm:
    "ستُنشر كل مسودات هذه الشعبة ويصل إشعار لكل طالب، ولا يمكن التراجع عن النشر. متابعة؟",
  publishedAll: "تم نشر {count} تقريرًا",
  publish: "نشر",
  publishTitle: "نشر التقرير",
  publishConfirm:
    "سيُنشر تقرير «{name}» ويصبح مرئيًا له في البوابة، ولا يمكن التراجع عن النشر. متابعة؟",
  published: "تم نشر التقرير",

  // Roster table
  colStudent: "الطالب",
  colAvg: "المعدل العام",
  colStatus: "الحالة",
  colComputedAt: "حُسب في",
  statusDraft: "مسودة",
  statusPublished: "منشور",
  emptyRoster: "لا طلاب مسجّلين في هذه الشعبة",
  preview: "معاينة",
  previewTitle: "معاينة التقرير",

  // Remarks dialog
  remarks: "ملاحظة",
  remarksTitle: "ملاحظة المعلم",
  remarksHint: "تظهر الملاحظة في تقرير الطالب المطبوع.",
  remarksPlaceholder: "اكتب ملاحظة للطالب…",
  remarksSaved: "تم حفظ الملاحظة",

  // Report card sheet (shared admin preview / portal / print)
  cardTitle: "تقرير الفصل الدراسي",
  studentLabel: "الطالب",
  colSubject: "المادة",
  colExamsPct: "الاختبارات ٪",
  colHomeworkPct: "الواجبات ٪",
  colParticipationPct: "المشاركة ٪",
  colFinalPct: "الدرجة النهائية ٪",
  noSubjects: "لا مواد في هذا التقرير بعد.",
  attendanceTitle: "ملخص الحضور",
  attPresent: "حضر",
  attLate: "تأخر",
  attAbsent: "غاب",
  attRate: "النسبة",
  remarksBlock: "ملاحظات المعلم",
  signature: "التوقيع",
  date: "التاريخ",
  pct: "{pct}٪",
  publishedAtLine: "نُشر في {date}",
  computedAtLine: "حُسب في {date}",

  // Student portal
  portalEmptyTitle: "لا تقارير بعد",
  portalEmptyBody: "يظهر تقرير الفصل هنا فور نشره من إدارة المدرسة.",
  downloadPdf: "تنزيل PDF",
  backToReports: "عودة إلى التقارير",
  cannotOpenTitle: "تعذّر فتح التقرير",
  homeCardTitle: "التقارير",
  homeCardBody: "درجات الفصل وملخص الحضور",

  // Errors (ConvexError machine codes)
  errNotFound: "التقرير غير موجود",
  errClassNotFound: "الشعبة غير موجودة",
  errTermNotFound: "الفصل الدراسي غير موجود",
  errPublished: "التقرير منشور ولا يمكن تعديله",
  errInvalidInput: "الملاحظة أطول من المسموح",
} as const;
