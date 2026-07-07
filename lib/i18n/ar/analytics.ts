// M10 staff analytics strings — owned by the staff-analytics feature.
export const analytics = {
  title: "التحليلات",
  pct: "{pct}٪",

  // Pickers
  classLabel: "الفصل",
  selectClass: "اختر الفصل",
  subjectLabel: "المادة",
  selectSubject: "اختر المادة",
  pickClassTitle: "اختر فصلًا",
  pickClassBody: "اختر فصلًا من القائمة لعرض تحليلاته.",
  noSubjects: "لا مواد مرتبطة بهذا الفصل بعد.",

  // Teacher: exam averages
  examAvgTitle: "متوسط الاختبارات",
  examAvgEmpty:
    "لا توجد اختبارات منتهية بعد — تظهر المتوسطات بعد إغلاق أول اختبار.",

  // Teacher: attendance trend
  attendanceTrendTitle: "نسبة الحضور (30 يومًا)",
  attendanceTrendEmpty: "لا يوجد حضور مسجَّل في آخر 30 يومًا.",
  latestRate: "آخر نسبة مسجَّلة",

  // Teacher: subject averages
  subjectAvgTitle: "متوسط حسب المادة",
  subjectAvgEmpty: "لا متوسطات بعد — تظهر بعد اكتمال تصحيح أول اختبار.",

  // Teacher: weak topics
  weakTopicsTitle: "المواضيع الأضعف",
  weakTopicsEmpty: "لا بيانات كافية بعد (تُستثنى الأسئلة بلا موضوع).",
  answersCount: "من {total} إجابة",
  recommendPrefix: "ننصح بمراجعة:",
  recommendItem: "{topic} — {subject}",

  // Admin: overview tiles
  activeStudents: "الطلاب النشطون",
  attendanceToday: "حضور اليوم",
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
  examsThisWeek: "اختبارات هذا الأسبوع",
  attendanceRate30d: "نسبة الحضور (30 يومًا)",

  // Admin: top students + leaderboard
  topStudents: "الأوائل",
  topStudentsEmpty: "لا نقاط بعد — تُمنح النقاط على الحضور والاختبارات والواجبات.",
  leaderboard: "لوحة الصدارة",
  tabByClass: "حسب الفصل",
  tabSchool: "المدرسة كلها",
  pickClassForBoard: "اختر فصلًا لعرض لوحة صدارته.",
  boardEmpty: "لا نقاط لعرضها بعد.",
  colRank: "الترتيب",
  colStudent: "الطالب",
  colPoints: "النقاط",
  colLevel: "المستوى",
  levelBadge: "المستوى {level}",
  pointsN: "{n} نقطة",
} as const;
