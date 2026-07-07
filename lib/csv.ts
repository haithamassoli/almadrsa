/**
 * M15 — shared CSV export helpers (client-side download). The generated
 * string is prefixed with a UTF-8 BOM so Excel detects the encoding of the
 * Arabic headers/content, and cells are escaped per RFC 4180.
 */

export type CsvHeader = { key: string; label: string };

/** Quote a cell when it holds a comma, quote or line break. */
function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows → BOM-prefixed CSV; `headers` fixes column order and labels. */
export function toCsv(
  rows: Array<Record<string, string | number>>,
  headers: Array<CsvHeader>,
): string {
  const lines = [
    headers.map((header) => escapeCell(header.label)).join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header.key];
          return escapeCell(value === undefined ? "" : value);
        })
        .join(","),
    ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

/** Trigger a browser download of `csv` under `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
