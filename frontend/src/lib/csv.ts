/**
 * A CSV file made in the browser from what the screen already shows. Every cell is quoted, and a cell that a spreadsheet would
 * read as a formula (starting with = + - @ or a tab/return) is prefixed with an apostrophe, so a tenant's name can never run code.
 */
const cell = (v: string | number | null | undefined) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !(typeof v === "number")) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const url = URL.createObjectURL(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" })); // the BOM makes Excel read ₹ and Indian names correctly
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
