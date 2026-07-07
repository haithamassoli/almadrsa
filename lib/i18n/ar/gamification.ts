// M6 gamification strings — owned by the gamification feature.
export const gamification = {
  // Portal strip
  points: "النقاط",
  streak: "أيام متتالية",

  // Admin page
  title: "التحفيز",
  description:
    "اضبط نقاط الحضور وعتبات نقاط الاختبارات التي يكسبها الطلاب.",
  attendanceCardTitle: "نقاط الحضور",
  present: "حاضر",
  late: "متأخر",
  homeworkSubmit: "تسليم واجب",
  thresholdsCardTitle: "عتبات نقاط الاختبارات",
  thresholdsHint: "أعلى عتبة مطابِقة هي التي تُحتسب.",
  minPct: "النسبة على الأقل ٪",
  thresholdPoints: "النقاط",
  addThreshold: "إضافة عتبة",
  removeThreshold: "حذف العتبة",
  save: "حفظ",
  saved: "تم حفظ إعدادات التحفيز",
  errInvalidConfig:
    "قيم غير صالحة: نقاط الحضور 0–1000، والعتبات نسبتها 1–100 ونقاطها غير سالبة.",
} as const;
