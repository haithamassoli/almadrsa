// M10 portal progress strings — owned by the portal-progress feature.
export const progress = {
  title: "تقدّمي",
  openFromHome: "عرض صفحة التقدّم",

  // Level card
  levelN: "المستوى {level}",
  statsLine: "{points} نقطة · {streak} أيام متتالية",
  levelProgressLabel: "التقدّم نحو المستوى التالي",
  levelProgressValue: "{into} من {next} نقطة",
  classRankLine: "ترتيبك في فصلك: {rank} من {size}",
  schoolRankLine: "ترتيبك في المدرسة: {rank}",

  // Badges
  badgesTitle: "الأوسمة",
  badgeEarnedSr: "وسام مُكتسَب",
  badgeLockedSr: "وسام لم يُكتسَب بعد",
  badgePoints100: "100 نقطة",
  badgePoints500: "500 نقطة",
  badgePoints1000: "1000 نقطة",
  badgeStreak7: "7 أيام متتالية",
  badgeStreak30: "30 يومًا متتاليًا",
  badgePerfectExam: "علامة كاملة",
  badgeHomework10: "10 واجبات مسلَّمة",
  badgeAttendance30: "30 يوم حضور",

  // Leaderboards
  leaderboardTitle: "لوحة الصدارة",
  tabClass: "فصلي",
  tabSchool: "المدرسة",
  youChip: "أنت",
  levelBadge: "مستوى {level}",
  pointsN: "{n} نقطة",
  boardEmpty: "لا بيانات لعرضها بعد — ستظهر لوحة الصدارة حين تُسجَّل النقاط.",

  // Charts
  compareTitle: "أدائي مقابل الفصل",
  legendMine: "درجتي",
  legendClass: "متوسط الفصل",
  trendTitle: "اتجاه درجاتي",
  weekdayTitle: "حضوري حسب اليوم",
  weekday0: "الأحد",
  weekday1: "الاثنين",
  weekday2: "الثلاثاء",
  weekday3: "الأربعاء",
  weekday4: "الخميس",
  examsEmpty: "لا نتائج اختبارات بعد — بعد تقديم أول اختبار ستظهر رسومك هنا.",
  attendanceEmpty: "لا سجلات حضور في آخر 30 يومًا.",

  // Weak topics
  weakTitle: "مواضيع تحتاج مراجعة",
  weakHint: "راجع هذه المواضيع ثم جرّب اختبارات بنك الأسئلة.",
} as const;
