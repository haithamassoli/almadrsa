// M14 digital library strings — owned by the library feature. Covers the
// teacher management page (list, add/edit dialog, delete) and the student
// portal listing grouped by subject.
export const library = {
  // ——— Teacher page ———
  title: "المكتبة",
  addResource: "إضافة مصدر",
  allClasses: "كل الفصول",
  allSubjects: "كل المواد",
  classFilter: "تصفية حسب الفصل",
  subjectFilter: "تصفية حسب المادة",
  colTitle: "العنوان",
  colSubject: "المادة",
  colScope: "النطاق",
  forAllSections: "لكل الشعب",
  openResource: "فتح المصدر {title} في تبويب جديد",
  count: "{count} مصدر",

  // Empty states
  emptyTitle: "لا مصادر بعد",
  emptyBody: "أضف أول رابط تعليمي وسيظهر فورًا لطلاب المادة.",
  emptyFiltered: "لا مصادر مطابقة لهذا التصفية.",

  // Add / edit dialog
  editResource: "تعديل المصدر",
  fieldTitle: "العنوان",
  fieldUrl: "الرابط",
  fieldSubject: "المادة",
  fieldScope: "النطاق",
  fieldClass: "الشعبة",
  selectSubject: "اختر المادة",
  selectClass: "اختر الشعبة",
  scopeWholeGrade: "للصف كاملًا (كل الشعب)",
  scopeSpecificClass: "لشعبة محددة",
  created: "أُضيف المصدر",
  updated: "تم حفظ التعديلات",

  // Delete
  deleteConfirmTitle: "حذف المصدر؟",
  deleteConfirmBody: "سيُحذف المصدر «{title}» نهائيًا.",
  deleted: "حُذف المصدر",

  // Backend machine codes
  errNotFound: "المصدر غير موجود أو لا تملك صلاحية الوصول إليه.",
  errNotAssigned: "لست معيّنًا لتدريس هذه المادة.",
  errInvalidResource: "بيانات غير صالحة — تأكد من العنوان ومن أن الرابط يبدأ بـ http أو https.",

  // ——— Student portal ———
  portalTitle: "المكتبة",
  portalEmptyTitle: "لا مصادر بعد",
  portalEmptyBody: "ستظهر هنا الروابط والمصادر التي يضيفها معلّموك.",

  // Home shortcut card
  homeCardTitle: "المكتبة",
  homeCardBody: "روابط ومصادر من معلّميك",
} as const;
