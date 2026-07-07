export const students = {
  title: "الطلاب",
  addStudent: "إضافة طالب",
  editStudent: "تعديل بيانات الطالب",
  importCsv: "استيراد CSV",
  searchPlaceholder: "ابحث باسم الطالب…",
  allClasses: "كل الشعب",
  noClass: "بدون شعبة",
  allStatuses: "كل الحالات",
  statusFilter: "الحالة",
  classFilter: "الشعبة",
  fullName: "اسم الطالب",
  firstName: "الاسم الأول",
  lastName: "اسم العائلة",
  guardianName: "ولي الأمر",
  guardianPhone: "هاتف ولي الأمر",
  class: "الشعبة",
  empty: "لا يوجد طلاب مطابقون",
  count: "{count} طالبًا",

  // Dialog actions / toasts
  created: "تمت إضافة الطالب",
  updated: "تم حفظ التعديلات",
  archived: "تمت أرشفة الطالب",
  deleted: "تم حذف الطالب",
  archive: "أرشفة",
  archiveTitle: "أرشفة الطالب",
  archiveConfirm:
    "سيتحول الطالب «{name}» إلى الحالة «مؤرشف»، وسيُلغى تسجيله في شعبته ويُبطل رمز الدخول الخاص به. متابعة؟",
  deleteTitle: "حذف الطالب نهائيًا",
  deleteConfirm:
    "سيُحذف الطالب «{name}» مع كل تسجيلاته ورموز دخوله نهائيًا ولا يمكن التراجع عن ذلك. متابعة؟",

  // CSV import
  importTitle: "استيراد طلاب من ملف CSV",
  importHint:
    "الترويسة المدعومة: firstName, lastName, guardianName, guardianPhone, className — أو بالعربية: الاسم الأول، اسم العائلة، ولي الأمر، الهاتف، الشعبة. عمودا الاسم مطلوبان.",
  chooseFile: "اختيار ملف CSV",
  previewTitle: "معاينة أول {count} صفوف",
  rowsFound: "تم العثور على {count} صفًا",
  import: "استيراد",
  importing: "جارٍ الاستيراد…",
  importSummary: "اكتمل الاستيراد: {ok} نجح · {fail} فشل",
  failedRowsTitle: "صفوف لم تُستورد",
  rowLabel: "الصف {row}",
  fileEmpty: "الملف لا يحتوي على صفوف بيانات",
  missingHeader:
    "ترويسة الملف غير صحيحة — عمودا firstName و lastName (أو الاسم الأول واسم العائلة) مطلوبان",
  fileReadError: "تعذر قراءة الملف",

  // Machine error codes → Arabic
  errInvalidFirstName: "الاسم الأول غير صالح",
  errInvalidLastName: "اسم العائلة غير صالح",
  errInvalidGuardianName: "اسم ولي الأمر غير صالح",
  errInvalidPhone: "رقم الهاتف غير صالح",
  errClassNotFound: "الشعبة غير موجودة",
  errTooManyRows: "عدد الصفوف يتجاوز الحد الأقصى (500)",
  errNotFound: "الطالب غير موجود",
} as const;
