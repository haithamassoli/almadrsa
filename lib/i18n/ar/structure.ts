export const structure = {
  title: "الهيكل الأكاديمي",
  description:
    "إدارة الصفوف والمواد والشُعب والفصول الدراسية وإسناد المعلمين.",

  // Tabs
  tabGrades: "الصفوف",
  tabSubjects: "المواد",
  tabClasses: "الشُعب",
  tabTerms: "الفصول الدراسية",
  tabAssignments: "إسناد المعلمين",

  // Shared
  selectGrade: "اختر الصف",
  selectGradeFirst: "اختر صفًا لعرض عناصره",
  noGradesYet: "لا توجد صفوف بعد — أضف صفًا من تبويب الصفوف أولًا.",

  // Grades
  gradeName: "اسم الصف",
  gradeOrder: "الترتيب",
  addGrade: "إضافة صف",
  editGrade: "تعديل الصف",
  deleteGrade: "حذف الصف",
  deleteGradeConfirm:
    "سيتم حذف الصف «{name}» نهائيًا. لا يمكن التراجع عن هذا الإجراء.",
  gradeCreated: "تمت إضافة الصف",
  gradeUpdated: "تم تحديث الصف",
  gradeDeleted: "تم حذف الصف",
  noGrades: "لا توجد صفوف بعد",
  noGradesHint: "ابدأ ببناء الهيكل بإضافة أول صف دراسي.",

  // Subjects
  subjectName: "اسم المادة",
  addSubject: "إضافة مادة",
  editSubject: "تعديل المادة",
  deleteSubject: "حذف المادة",
  deleteSubjectConfirm:
    "سيتم حذف المادة «{name}» نهائيًا. لا يمكن التراجع عن هذا الإجراء.",
  subjectCreated: "تمت إضافة المادة",
  subjectUpdated: "تم تحديث المادة",
  subjectDeleted: "تم حذف المادة",
  noSubjects: "لا توجد مواد لهذا الصف بعد",
  noSubjectsHint: "أضف أول مادة لهذا الصف.",

  // Classes
  className: "اسم الشعبة",
  addClass: "إضافة شعبة",
  editClass: "تعديل الشعبة",
  deleteClass: "حذف الشعبة",
  deleteClassConfirm:
    "سيتم حذف الشعبة «{name}» نهائيًا. لا يمكن التراجع عن هذا الإجراء.",
  classCreated: "تمت إضافة الشعبة",
  classUpdated: "تم تحديث الشعبة",
  classDeleted: "تم حذف الشعبة",
  noClasses: "لا توجد شُعب لهذا الصف بعد",
  noClassesHint: "أضف أول شعبة لهذا الصف.",

  // Terms
  termName: "اسم الفصل الدراسي",
  startDate: "تاريخ البداية",
  endDate: "تاريخ النهاية",
  addTerm: "إضافة فصل دراسي",
  editTerm: "تعديل الفصل الدراسي",
  deleteTerm: "حذف الفصل الدراسي",
  deleteTermConfirm:
    "سيتم حذف الفصل الدراسي «{name}» نهائيًا. لا يمكن التراجع عن هذا الإجراء.",
  termCreated: "تمت إضافة الفصل الدراسي",
  termUpdated: "تم تحديث الفصل الدراسي",
  termDeleted: "تم حذف الفصل الدراسي",
  activeTerm: "الفصل النشط",
  setActive: "تعيين كنشط",
  termActivated: "تم تعيين الفصل النشط",
  noTerms: "لا توجد فصول دراسية بعد",
  noTermsHint: "أضف الفصل الدراسي الأول وعيّنه كنشط.",

  // Teacher assignments
  selectClass: "اختر الشعبة",
  selectClassFirst: "اختر شعبة لعرض إسناداتها",
  noClassesYet: "لا توجد شُعب بعد — أضف شعبة من تبويب الشُعب أولًا.",
  teacher: "المعلّم",
  subject: "المادة",
  selectTeacher: "اختر المعلّم",
  selectSubject: "اختر المادة",
  addAssignment: "إضافة إسناد",
  deleteAssignment: "حذف الإسناد",
  deleteAssignmentConfirm:
    "سيتم إلغاء إسناد «{teacher}» لمادة «{subject}» في هذه الشعبة.",
  assignmentCreated: "تم إسناد المعلّم",
  assignmentDeleted: "تم حذف الإسناد",
  noAssignments: "لا توجد إسنادات لهذه الشعبة بعد",
  noAssignmentsHint: "أسنِد معلّمًا إلى مادة في هذه الشعبة.",
  noTeachers: "لا يوجد معلّمون — أنشئ حسابات معلّمين من صفحة الطاقم أولًا.",
  noSubjectsForClass: "لا توجد مواد لصف هذه الشعبة — أضفها أولًا.",

  // Server rejection codes
  errGradeNotEmpty: "لا يمكن حذف الصف لوجود مواد أو شُعب مرتبطة به.",
  errSubjectInUse: "لا يمكن حذف المادة لوجود إسنادات معلمين مرتبطة بها.",
  errClassNotEmpty: "لا يمكن حذف الشعبة لوجود طلاب مسجّلين فيها.",
  errTermDates: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية.",
  errTermIsActive: "لا يمكن حذف الفصل الدراسي النشط — عيّن فصلًا آخر أولًا.",
  errAssignmentDuplicate: "هذه المادة مسندة بالفعل إلى معلّم في هذه الشعبة.",
  errAssignmentGradeMismatch: "المادة لا تنتمي إلى صف هذه الشعبة.",
  errAssignmentTeacherInvalid: "حساب المعلّم غير صالح أو معطّل.",
  errNotFound: "العنصر غير موجود — ربما حُذف للتو.",
  errInvalidInput: "قيمة غير صالحة — تحقق من الحقول.",
} as const;
