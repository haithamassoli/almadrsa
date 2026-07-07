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
  typeFillblank: "ملء الفراغ",
  typeMatching: "مطابقة",
  typeOrdering: "ترتيب",
  typeEssay: "مقالي",

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

  // M8 — fill-blank editor
  fillblankHint: "استخدم ____ لكل فراغ",
  blanksLabel: "الفراغات وإجاباتها المقبولة",
  blanksDetected: "عدد الفراغات في النص: {n}",
  blankPlaceholder: "إجابات الفراغ {n} المقبولة، مفصولة بفواصل",
  addBlank: "إضافة فراغ",
  removeBlank: "حذف الفراغ",

  // M8 — matching editor
  pairsLabel: "أزواج المطابقة",
  pairLeftPlaceholder: "اليسار {n}",
  pairRightPlaceholder: "اليمين {n}",
  addPair: "إضافة زوج",
  removePair: "حذف الزوج",

  // M8 — ordering editor
  itemsLabel: "العناصر",
  orderingHint: "رتّبها هنا بالترتيب الصحيح؛ ستُخلط للطالب",
  itemPlaceholder: "العنصر {n}",
  addItem: "إضافة عنصر",
  removeItem: "حذف العنصر",
  moveUp: "نقل لأعلى",
  moveDown: "نقل لأسفل",

  // M8 — essay editor
  rubricLabel: "معايير التصحيح (اختياري، يظهر لك فقط أثناء التصحيح)",
  rubricPlaceholder: "ما الذي ستقيّمه في إجابة الطالب؟",
  hasRubricBadge: "معايير تصحيح",

  // M8 — question image
  imageLabel: "صورة توضيحية (اختياري)",
  imageRemove: "إزالة الصورة",
  imageAlt: "صورة السؤال",
  imageTooLarge: "حجم الصورة يتجاوز 10 ميغابايت.",
  imageInvalidType: "اختر ملف صورة.",
  imageUploadError: "تعذّر رفع الصورة. حاول مرة أخرى.",

  // M8 — card meta
  blanksCount: "عدد الفراغات: {n}",
  pairsCount: "عدد الأزواج: {n}",
  itemsCount: "عدد العناصر: {n}",

  // M8 — client validation
  valBlankCount:
    "عدد الفراغات ({rows}) لا يطابق عدد ____ في نص السؤال ({placeholders}).",
  valBlankAnswers: "أدخل إجابة مقبولة واحدة على الأقل لكل فراغ.",
  valBlankAnswerLength: "كل إجابة مقبولة بحد أقصى 200 حرف.",
  valBlankAnswersMax: "بحد أقصى 20 إجابة مقبولة لكل فراغ.",
  valPairText: "أكمل طرفي كل زوج.",
  valItemText: "نص كل عنصر مطلوب.",
} as const;
