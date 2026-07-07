// M11 QR check-in strings — owned by the qr-checkin feature.
export const checkin = {
  // Teacher-facing QR dialog
  qrButton: "رمز QR للحضور",
  qrTitle: "رمز QR للحضور",
  qrHint: "اطلب من الطلاب مسح الرمز بكاميرا الهاتف",
  qrExpiry: "صالح لساعتين",
  qrError: "تعذّر إنشاء الرمز، حاول مرة أخرى",

  // Student check-in page
  title: "تسجيل الحضور",
  confirmDescription: "اضغط الزر لتسجيل حضورك في هذه الحصة",
  confirmButton: "سجّل حضوري",
  successMarked: "سُجّل حضورك — {title}",
  alreadyMarked: "حضورك مسجَّل مسبقًا",
  home: "الرئيسية",

  // Error states
  errInvalidToken: "رمز غير صالح",
  errTokenExpired: "انتهت صلاحية الرمز، اطلب رمزًا جديدًا من معلّمك",
  errNotEnrolled: "لست مسجّلًا في هذا الصف",
  errGeneric: "تعذّر تسجيل الحضور، حاول مرة أخرى",
} as const;
