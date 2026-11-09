// A small, safe Markdown renderer for AI answers: paragraphs, bullet and
// numbered lists, headings (shown as bold lines), **bold**, *italic* and
// `code`. Everything is HTML-escaped first, so text from a model or a client
// document can never inject markup. Anything it doesn't understand is shown
// as plain text, never as stray asterisks.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// v1.7: links. A Markdown link is kept only when it points inside ARGUS (a path
// starting with one "/"); anything else is shown as its text. Record keys
// (AI-3, R-4, C-2...) become links when a resolver knows where they live.
export type KeyLinker = (key: string) => string | null;
let linker: KeyLinker | null = null;
const KEY = /\b(INC|[A-Z]{1,5})-(\d{1,5})\b/g;

function inline(s: string): string {
  const keep: string[] = [];
  const hold = (html: string) => `\u0000${keep.push(html) - 1}\u0000`;
  let t = esc(s)
    .replace(/`([^`]+)`/g, (_m, c) => hold(`<code>${c}</code>`))
    .replace(/\[([^\]]{1,120})\]\(([^)\s]{1,300})\)/g, (_m, label, href) =>
      /^\/(?!\/)/.test(href) && !/^\/api\b/.test(href) ? hold(`<a href="${href}" class="md-link" data-internal="1">${label}</a>`) : label);
  if (linker) t = t.replace(KEY, (m) => { const href = linker!(m); return href ? hold(`<a href="${href}" class="md-link md-key" data-internal="1">${m}</a>`) : m; });
  return t
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    // Leftover markers a model left unbalanced are dropped, not shown.
    .replace(/\*\*/g, '')
    .replace(/\u0000(\d+)\u0000/g, (_m, i) => keep[Number(i)]);
}

export function renderMarkdown(text: string, keyLinker?: KeyLinker): string {
  linker = keyLinker ?? null;
  const lines = (text ?? '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const head = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (bullet || num) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((bullet ?? num)![1])}</li>`);
    } else if (head) {
      flushPara(); closeList();
      out.push(`<p class="md-head"><strong>${inline(head[1].replace(/\*\*/g, ''))}</strong></p>`);
    } else if (!line.trim()) {
      flushPara(); closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara(); closeList();
  return out.join('');
}
