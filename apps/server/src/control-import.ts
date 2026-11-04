// Upload controls from a spreadsheet (CSV or Excel). Each row becomes a
// control, as if added by hand: same checks, one audit entry per control.
// The upload is read twice: first as a preview (nothing saved) so the person
// sees which rows will be added and which won't, then for real.
import ExcelJS from 'exceljs';

export interface ImportRow { row: number; title: string; objective: string; type: string; frequency: string; owner: string; useCase: string; libraryCode: string; risks: string[] }

const HEADERS: Record<string, keyof ImportRow> = {
  title: 'title', control: 'title', name: 'title',
  objective: 'objective', description: 'objective', 'what it does': 'objective',
  type: 'type', frequency: 'frequency', owner: 'owner', 'control owner': 'owner',
  'use case': 'useCase', usecase: 'useCase', card: 'useCase',
  'library code': 'libraryCode', code: 'libraryCode', library: 'libraryCode',
  risks: 'risks', risk: 'risks', treats: 'risks',
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[0];
  const out: string[][] = [];
  ws?.eachRow((r) => {
    const vals = (r.values as any[]).slice(1).map((v) => (v == null ? '' : typeof v === 'object' ? String(v.text ?? v.result ?? v.richText?.map((t: any) => t.text).join('') ?? '') : String(v)));
    out.push(vals);
  });
  return out.filter((r) => r.some((x) => x.trim()));
}

export async function readControls(buf: Buffer, filename: string): Promise<{ rows: ImportRow[]; problems: string[] }> {
  const table = /\.xlsx$/i.test(filename) ? await parseXlsx(buf) : parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  const problems: string[] = [];
  if (table.length < 2) return { rows: [], problems: ['The file needs a header row and at least one control.'] };
  const head = table[0].map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
  if (!head.includes('title')) return { rows: [], problems: ['No "Title" column. Download the template to see the columns.'] };
  const rows: ImportRow[] = [];
  table.slice(1, 501).forEach((cells, i) => {
    const r: any = { row: i + 2, title: '', objective: '', type: 'preventive', frequency: 'per change', owner: '', useCase: '', libraryCode: '', risks: [] };
    head.forEach((k, j) => {
      const v = (cells[j] ?? '').trim();
      if (!k || !v) return;
      r[k] = k === 'risks' ? v.split(/[;,\s]+/).filter(Boolean).map((x) => x.toUpperCase()) : v;
    });
    r.type = String(r.type).toLowerCase();
    rows.push(r);
  });
  if (table.length > 501) problems.push('Only the first 500 rows were read.');
  return { rows, problems };
}

export const TEMPLATE_CSV = [
  'Title,Objective,Type,Frequency,Owner,Use case,Library code,Risks',
  '"Human review of declined applications","A trained officer reviews every AI decline before the customer is told",preventive,per decision,Head of Retail Credit,AI-1,OVS-01,R-1',
  '"Quarterly bias test of the scoring model","Compare approval rates across groups each quarter and report gaps above 5 points",detective,quarterly,Model Risk Manager,AI-1,,R-2; R-3',
].join('\n');
