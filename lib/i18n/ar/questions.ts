// M4 teacher question-bank strings — owned by the question-bank feature.
export const questions = {
  title: "بنك الأسئلة",
  subjectLabel: "المادة",
  subjectOptionLabel: "{subject} — {grade}",
  addQuestion: "إضافة سؤال",
  editQuestion: "تعديل السؤال",
  firstQuestion: "أضف أول سؤال",
  count: "{count} سؤالًا",

  // Filters
  allTypes: "كل الأنواع",
  allDifficulties: "كل المستويات",
  typeFilter: "النوع",
  difficultyFilter: "المستوى",
  topicFilter: "الموضوع",
  topicFilterPlaceholder: "تصفية بالموضوع…",

  // Type labels
  typeMcq: "اختيار من متعدد",
  typeTruefalse: "صح أو خطأ",

  // Difficulty labels
  difficultyEasy: "سهل",
  difficultyMedium: "متوسط",
  difficultyHard: "صعب",

  // True / false
  answerTrue: "صح",
  answerFalse: "خطأ",

  // Card
  correctAnswerBadge: "الإجابة الصحيحة",

  // Dialog fields
  typeLabel: "نوع السؤال",
  questionTextLabel: "نص السؤال",
  questionTextPlaceholder: "اكتب نص السؤال…",
  optionsLabel: "الخيارات",
  optionPlaceholder: "الخيار {n}",
  markCorrect: "تحديد كإجابة صحيحة",
  addOption: "إضافة خيار",
  removeOption: "حذف الخيار",
  correctAnswerLabel: "الإجابة الصحيحة",
  topicLabel: "الموضوع (اختياري)",
  topicPlaceholder: "مثال: الكسور العشرية",
  difficultyLabel: "المستوى",

  // Toasts
  created: "تمت إضافة السؤال",
  updated: "تم حفظ التعديلات",
  archived: "تمت أرشفة السؤال",

  // Archive confirm
  archive: "أرشفة",
  archiveTitle: "أرشفة السؤال",
  archiveConfirm:
    "سيُخفى هذا السؤال من البنك ولن يُستخدم في اختبارات جديدة، مع بقائه في الاختبارات التي تستعمله. متابعة؟",

  // Empty / loading
  noSubjectTitle: "اختر مادة",
  noSubjectBody: "اختر مادة من الأعلى لعرض بنك أسئلتها.",
  emptyTitle: "لا توجد أسئلة بعد",
  emptyBody: "ابدأ ببناء بنك الأسئلة لهذه المادة.",
  noMatch: "لا توجد أسئلة مطابقة للتصفية",

  // Client validation
  valText: "نص السؤال مطلوب",
  valOptionText: "نص كل خيار مطلوب",
  valCorrect: "حدِّد الإجابة الصحيحة",

  // Machine error codes → Arabic
  errInvalidQuestion: "بيانات السؤال غير صالحة",
  errNotAssigned: "لست مُسندًا لتدريس هذه المادة",
  errNotOwner: "لا تملك صلاحية تعديل هذا السؤال",
  errNotFound: "السؤال غير موجود",
} as const;
