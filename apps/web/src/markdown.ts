// A small, safe Markdown renderer for AI answers: paragraphs, bullet and
// numbered lists, headings (shown as bold lines), **bold**, *italic* and
// `code`. Everything is HTML-escaped first, so text from a model or a client
// document can never inject markup. Anything it doesn't understand is shown
// as plain text, never as stray asterisks.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    // Leftover markers a model left unbalanced are dropped, not shown.
    .replace(/\*\*/g, '');
}

export function renderMarkdown(text: string): string {
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
