/**
 * A tiny, dependency-free PDF writer for one-page receipts: A4, the two standard Helvetica fonts, text and thin rules.
 * No packages, no font files, no network: the output is deterministic, so it is easy to test. Text is WinAnsi (Latin-1);
 * anything else (including ₹, which the standard fonts lack) is written as a plain stand-in.
 */
export interface PdfLine { text: string; x: number; y: number; size?: number; bold?: boolean; gray?: number }
export interface PdfRule { x1: number; x2: number; y: number; gray?: number }
export interface PdfBox { x: number; y: number; w: number; h: number; gray: number }

export const A4 = { w: 595, h: 842 } as const;

const latin1 = (s: string) => s.replace(/₹/g, 'Rs ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const esc = (s: string) => latin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const num = (n: number) => (Math.round(n * 100) / 100).toString();

export function buildPdf(page: { lines: PdfLine[]; rules?: PdfRule[]; boxes?: PdfBox[]; title: string }): Buffer {
  let content = '';
  for (const b of page.boxes ?? []) content += `${num(b.gray)} g ${num(b.x)} ${num(b.y)} ${num(b.w)} ${num(b.h)} re f\n`;
  for (const r of page.rules ?? []) content += `${num(r.gray ?? 0.8)} G 0.6 w ${num(r.x1)} ${num(r.y)} m ${num(r.x2)} ${num(r.y)} l S\n`;
  for (const l of page.lines) content += `BT /${l.bold ? 'F2' : 'F1'} ${num(l.size ?? 10)} Tf ${num(l.gray ?? 0)} g ${num(l.x)} ${num(l.y)} Td (${esc(l.text)}) Tj ET\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    `<< /Title (${esc(page.title)}) /Producer (Hostel Booking) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
