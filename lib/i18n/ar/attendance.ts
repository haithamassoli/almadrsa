// M3 attendance strings — owned by the attendance feature.
export const attendance = {
  title: "سجل الحضور",
  tabByClass: "حسب الفصل",
  tabByStudent: "حسب الطالب",

  // Shared controls
  classLabel: "الفصل",
  studentLabel: "الطالب",
  selectClass: "اختر الفصل",
  selectStudent: "اختر الطالب",
  from: "من",
  to: "إلى",

  // Summary cards
  presentTotal: "الحاضرون",
  lateTotal: "المتأخرون",
  absentTotal: "الغائبون",
  attendanceRate: "نسبة الحضور",

  // Table columns
  colDate: "التاريخ",
  colPeriod: "الحصة",
  colSubject: "المادة",
  colPresent: "حاضر",
  colLate: "متأخر",
  colAbsent: "غائب",
  colStatus: "الحالة",

  // Status labels
  statusPresent: "حاضر",
  statusLate: "متأخر",
  statusAbsent: "غائب",

  notRecorded: "لم يُسجَّل",
  openLesson: "فتح الحصة",

  // Empty states
  pickClassTitle: "اختر فصلًا",
  pickClassBody: "اختر فصلًا من القائمة لعرض سجل الحضور ضمن نطاق التاريخ.",
  pickStudentTitle: "اختر طالبًا",
  pickStudentBody: "اختر فصلًا ثم طالبًا لعرض سجل حضوره.",
  noLessonsTitle: "لا توجد حصص",
  noLessonsBody: "لم تُسجَّل أي حصص لهذا الفصل ضمن النطاق المحدَّد.",
  noRecordsTitle: "لا يوجد حضور مُسجَّل",
  noRecordsBody: "لا توجد سجلات حضور لهذا الطالب ضمن النطاق المحدَّد.",

  // M15 — CSV export
  exportCsv: "تصدير CSV",
  csvFileName: "سجل الحضور {from} - {to}",
} as const;
