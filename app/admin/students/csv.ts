/**
 * Tiny hand-rolled CSV parser for the students import dialog (no deps).
 * Handles quoted fields (including escaped quotes and embedded commas /
 * newlines), CRLF line endings and a UTF-8 BOM.
 */

export type CsvStudentRow = {
  firstName: string;
  lastName: string;
  guardianName?: string;
  guardianPhone?: string;
  className?: string;
};

type Column = keyof CsvStudentRow;

/** Accepted header spellings (Latin lower-cased · Arabic as-is). */
const HEADER_MAP: Record<string, Column> = {
  firstname: "firstName",
  "الاسم الأول": "firstName",
  lastname: "lastName",
  "اسم العائلة": "lastName",
  guardianname: "guardianName",
  "ولي الأمر": "guardianName",
  guardianphone: "guardianPhone",
  الهاتف: "guardianPhone",
  classname: "className",
  الشعبة: "className",
};

/** Raw CSV → array of records (arrays of fields). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export type ParsedStudentsCsv =
  | { ok: true; rows: CsvStudentRow[] }
  | { ok: false; error: "empty" | "missing_header" };

/** Full pipeline: text → header-mapped student rows. */
export function parseStudentsCsv(text: string): ParsedStudentsCsv {
  const records = parseCsv(text).filter(
    (r) => !(r.length === 1 && r[0].trim() === ""),
  );
  if (records.length === 0) return { ok: false, error: "empty" };

  const columns: Array<Column | null> = records[0].map((h) => {
    const trimmed = h.trim();
    return HEADER_MAP[trimmed.toLowerCase()] ?? HEADER_MAP[trimmed] ?? null;
  });
  if (!columns.includes("firstName") || !columns.includes("lastName")) {
    return { ok: false, error: "missing_header" };
  }

  const rows: CsvStudentRow[] = [];
  for (const record of records.slice(1)) {
    if (record.every((f) => f.trim() === "")) continue; // skip blank lines
    const row: CsvStudentRow = { firstName: "", lastName: "" };
    for (let i = 0; i < record.length && i < columns.length; i++) {
      const column = columns[i];
      if (!column) continue;
      const value = record[i].trim();
      if (value.length === 0) continue;
      row[column] = value;
    }
    rows.push(row);
  }
  if (rows.length === 0) return { ok: false, error: "empty" };
  return { ok: true, rows };
}
