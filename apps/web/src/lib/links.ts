// Where a record key lives in ARGUS (v1.7). Used to turn keys in AI answers
// into links, and by "?focus=" to point at one row of a register.
const REGISTER: Record<string, string> = {
  R: '/risks',
  C: '/controls/register',
  T: '/testing/tests',
  E: '/testing/evidence',
  I: '/issues',
  INC: '/incidents',
};

export function keyLink(key: string, cardKeys: Set<string>): string | null {
  const k = key.toUpperCase();
  if (cardKeys.has(k)) return `/?card=${encodeURIComponent(k)}`;
  const pre = k.split('-')[0];
  return REGISTER[pre] ? `${REGISTER[pre]}?focus=${encodeURIComponent(k)}` : null;
}

// After a page loads, scroll to the table row whose key cell matches and
// flash it, so a link like /risks?focus=R-4 lands on R-4. Tries for a few
// seconds while the page fetches its data.
export function focusRow(key: string) {
  const k = key.toUpperCase();
  let tries = 0;
  const look = () => {
    const cell = Array.from(document.querySelectorAll<HTMLElement>('main td, main .mono, .page td')).find(
      (el) => el.textContent?.trim().toUpperCase() === k,
    );
    const row = cell?.closest<HTMLElement>('tr, .card, li') ?? cell;
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('focus-flash');
      void row.offsetWidth;
      row.classList.add('focus-flash');
      return;
    }
    if (++tries < 20) setTimeout(look, 250);
  };
  setTimeout(look, 200);
}
