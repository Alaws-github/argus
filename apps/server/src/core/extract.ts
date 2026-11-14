// Reads the text out of evidence and client documents so agents and search
// can use it: PDFs (with a text layer), Excel workbooks, Word documents, and
// plain text formats. What it can't read it says so plainly; it never guesses.
// Scanned PDFs (images with no text layer) need OCR, which is not built.
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

/** Text read out of a file, and a note when only part could be read. */
export interface Extracted {
  text: string;
  // One line for the evidence list and the agent: what was read.
  note: string;
}

const MAX = 200_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|html?)$/i;

/** What kind of file this is, by name and type. */
export function kindOf(filename = '', mime = ''): 'pdf' | 'xlsx' | 'docx' | 'text' | null {
  if (/\.pdf$/i.test(filename) || mime === 'application/pdf') return 'pdf';
  if (/\.xlsx$/i.test(filename) || mime.includes('spreadsheetml')) return 'xlsx';
  if (/\.docx$/i.test(filename) || mime.includes('wordprocessingml')) return 'docx';
  if (TEXT_EXT.test(filename) || /^text\/|json|csv|xml|markdown/.test(mime)) return 'text';
  return null;
}

/** Reads the text out of a PDF, Excel, Word or text file, or null if it can't. */
export async function extract(buf: Buffer, filename = '', mime = ''): Promise<Extracted | null> {
  const kind = kindOf(filename, mime);
  if (!kind) return null;
  try {
    if (kind === 'text') {
      const text = buf.toString('utf8');
      return {
        text: text.slice(0, MAX),
        note: `Text file, ${text.length.toLocaleString()} characters${text.length > MAX ? ' (read the first 200,000)' : ''}`,
      };
    }
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      const pages = (text as string[]).map((t, i) => `[Page ${i + 1}]\n${t.trim()}`).filter((t) => t.length > 12);
      const joined = pages.join('\n\n');
      if (joined.replace(/\[Page \d+\]/g, '').trim().length < 20) {
        return {
          text: '',
          note: `PDF, ${totalPages} page${totalPages === 1 ? '' : 's'}, with no text layer (probably scanned). It needs OCR, which the harness can't do yet: add a note with what it shows.`,
        };
      }
      return { text: joined.slice(0, MAX), note: `PDF, ${totalPages} page${totalPages === 1 ? '' : 's'} read` };
    }
    if (kind === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as any);
      const parts: string[] = [];
      let rowsRead = 0;
      wb.eachSheet((ws) => {
        const lines: string[] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          if (lines.length >= 2000) return;
          const vals = (row.values as any[]).slice(1).map((v) => cell(v));
          lines.push(vals.join(','));
        });
        rowsRead += lines.length;
        parts.push(
          `[Sheet: ${ws.name}, ${ws.actualRowCount} rows${ws.actualRowCount > 2000 ? ', first 2,000 read' : ''}]\n${lines.join('\n')}`,
        );
      });
      return {
        text: parts.join('\n\n').slice(0, MAX),
        note: `Spreadsheet, ${parts.length} sheet${parts.length === 1 ? '' : 's'}, ${rowsRead.toLocaleString()} rows read`,
      };
    }
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: value.slice(0, MAX), note: `Word document, ${value.length.toLocaleString()} characters read` };
  } catch (e: any) {
    return {
      text: '',
      note: `Couldn't read this ${kind.toUpperCase()} file: ${String(e?.message ?? e).slice(0, 160)}`,
    };
  }
}

// A spreadsheet cell as text: formulas give their result, dates are ISO,
// rich text is flattened. Commas and quotes are escaped CSV-style.
function cell(v: any): string {
  if (v == null) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString().slice(0, 10);
  else if (typeof v === 'object') {
    if ('result' in v) s = String(v.result ?? '');
    else if ('richText' in v) s = v.richText.map((t: any) => t.text).join('');
    else if ('text' in v) s = String(v.text);
    else s = JSON.stringify(v);
  } else s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
