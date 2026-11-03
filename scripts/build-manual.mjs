// Builds docs/manual.pdf from docs/manual.md: Markdown to HTML with a cover,
// a contents page and print styles, then Chromium (Playwright) prints it with
// page numbers. Run: npm run manual (needs Playwright with Chromium: npx playwright install chromium).
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
const md = readFileSync(resolve(docs, 'manual.md'), 'utf8');
const [first, ...rest] = md.split('\n---\n');
const intro = marked.parse(first.split('\n').slice(3).join('\n'));

// Headings get ids; the contents list Parts (h1) and numbered sections (h2).
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const toc = [];
const renderer = new marked.Renderer();
renderer.heading = (text, depth) => {
  const id = slug(text);
  if (depth <= 2) toc.push({ depth, text, id });
  return `<h${depth} id="${id}">${text}</h${depth}>`;
};
renderer.image = (href, _title, text) => `<figure><img src="${pathToFileURL(resolve(docs, href)).href}" alt="${text}"><figcaption>${text}</figcaption></figure>`;
const body = rest.map((part) => marked.parse(part, { renderer })).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>ARGUS: User Manual</title><style>
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
body { font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; color: #1c2230; font-size: 10.5pt; line-height: 1.5; }
.cover { padding-top: 55mm; page-break-after: always; break-after: page; }
.cover .logo { width: 64px; height: 64px; border-radius: 14px; background: #4f5bd5; color: #fff; font: 700 34px/64px sans-serif; text-align: center; margin-bottom: 28px; }
.cover h1 { font-size: 34pt; margin: 0 0 8px; border: 0; letter-spacing: -0.02em; page-break-before: avoid; break-before: avoid; color: #1c2230; }
.cover .sub { font-size: 15pt; color: #4a5368; margin-bottom: 40px; }
.cover .meta { color: #6b7385; font-size: 10pt; border-top: 1px solid #dfe3ea; padding-top: 14px; }
.cover .intro { margin-top: 30px; font-size: 11pt; color: #333a4a; max-width: 150mm; }
.toc { page-break-after: always; }
.toc h1 { border: 0; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { padding: 3px 0; }
.toc li.d1 { font-weight: 700; margin-top: 10px; color: #4f5bd5; }
.toc li.d2 { padding-left: 14px; }
.toc a { color: inherit; text-decoration: none; }
h1 { font-size: 20pt; color: #4f5bd5; border-bottom: 2px solid #4f5bd5; padding-bottom: 6px; margin: 0 0 14px; page-break-before: always; letter-spacing: -0.01em; }
h2 { font-size: 14pt; margin: 22px 0 8px; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 16px 0 6px; page-break-after: avoid; color: #2b3245; }
p { margin: 0 0 8px; }
ul, ol { margin: 0 0 8px; padding-left: 20px; }
li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.2pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th { background: #eef0fb; text-align: left; font-weight: 600; }
th, td { border: 1px solid #dfe3ea; padding: 5px 7px; vertical-align: top; }
code, pre { font-family: "SFMono-Regular", Consolas, monospace; font-size: 9pt; }
pre { background: #f4f5f8; border: 1px solid #e3e6ec; border-radius: 6px; padding: 8px 10px; }
figure { margin: 10px 0 14px; page-break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 105mm; border: 1px solid #dfe3ea; border-radius: 6px; }
figcaption { font-size: 8.5pt; color: #6b7385; margin-top: 4px; }
strong { color: #141a26; }
</style></head><body>
<section class="cover">
  <div class="logo">G</div>
  <svg width="96" height="96" viewBox="0 0 32 32" fill="none" style="margin-bottom:10px"><ellipse cx="16.07" cy="13.47" rx="6.50" ry="2.15" transform="rotate(-112 16.07 13.47)" stroke="#1d2330" stroke-width="1.35"/>    <circle cx="14.90" cy="10.58" r="1.2" fill="#b45a26"/>    <ellipse cx="13.01" cy="14.39" rx="7.50" ry="2.15" transform="rotate(-137 13.01 14.39)" stroke="#1d2330" stroke-width="1.35"/>    <circle cx="10.38" cy="11.93" r="1.2" fill="#b45a26"/>    <ellipse cx="11.13" cy="17.11" rx="7.75" ry="2.15" transform="rotate(-162 11.13 17.11)" stroke="#1d2330" stroke-width="1.35"/>    <circle cx="7.59" cy="15.96" r="1.2" fill="#b45a26"/>    <ellipse cx="11.55" cy="20.35" rx="7.00" ry="2.15" transform="rotate(173 11.55 20.35)" stroke="#1d2330" stroke-width="1.35"/>    <circle cx="8.22" cy="20.76" r="1.2" fill="#b45a26"/>    <ellipse cx="13.52" cy="22.38" rx="5.75" ry="2.15" transform="rotate(150 13.52 22.38)" stroke="#1d2330" stroke-width="1.35"/>    <circle cx="11.13" cy="23.75" r="1.2" fill="#b45a26"/>    <path d="M17 22c2.6 3 6.6 2.9 8.3-.6 1.3-2.7.2-5.9-1.5-7.9-1-1.1-1.4-2.7-.8-4" stroke="#1d2330" stroke-width="1.7" stroke-linecap="round"/>    <circle cx="24.6" cy="7.6" r="2" stroke="#1d2330" stroke-width="1.5"/><path d="M26.5 7.2l2.4.8-2.3.8" stroke="#1d2330" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>    <path d="M20.4 24.8l-1.1 3.9M23.1 24.9l.4 3.8" stroke="#1d2330" stroke-width="1.4" stroke-linecap="round"/></svg>
  <h1>ARGUS</h1>
  <div class="sub">Assurance, Risk &amp; Governance Unified System</div>
  <div class="sub">User manual: the full flow, from first request to board report</div>
  <div class="meta">Version 1.2 · November 2026 · Prepared by Andrew Lawrence</div>
  <div class="intro">${intro}</div>
</section>
<section class="toc"><h1 style="page-break-before: avoid">Contents</h1><ol>${'__TOC__'}</ol></section>
${body}
</body></html>`;
const out = html.replace('__TOC__', toc.map((t) => `<li class="d${t.depth}"><a href="#${t.id}">${t.text}</a></li>`).join(''));
const tmp = resolve(docs, '.manual.html');
writeFileSync(tmp, out);
// Playwright is optional for the project: use a local install, else a global one.
const pw = await import('playwright').catch(() => import(pathToFileURL(resolve(execSync('npm root -g').toString().trim(), 'playwright/index.js')).href));
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: resolve(docs, 'manual.pdf'), format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="font-size:8px;color:#8a91a1;width:100%;padding:0 18mm;display:flex;justify-content:space-between"><span>ARGUS · User manual · v1.2</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: '18mm', bottom: '20mm', left: '18mm', right: '18mm' },
});
await browser.close();
unlinkSync(tmp);
console.log('Wrote docs/manual.pdf');
