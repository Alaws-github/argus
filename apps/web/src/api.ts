// Talking to the server: one fetch helper (sends the session cookie, sends you
// to sign-in when it lapses), the live-update socket, and small formatters.
import { io } from 'socket.io-client';

/** An API error with the HTTP status and the server's message, thrown by api(). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Calls the ARGUS API with the session cookie and returns the JSON. Throws ApiError with the server's
 * message on a 4xx or 5xx.
 */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  // A lapsed session sends everyone back to the sign-in screen.
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('gh:signed-out'));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

// Connected after sign-in: the server checks the session cookie on connect.
export const socket = io({ path: '/socket.io', autoConnect: false, withCredentials: true });

/** A date as "14 Nov 2026" in the browser's locale, or an empty string when there is none. */
export function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** A date and time in the browser's locale, or an empty string when there is none. */
export function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** Saves text as a file in the browser (exports and templates). */
export function downloadText(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Rows as CSV text, quoting each cell that needs it. */
export function csv(rows: unknown[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

/** An amount in US dollars to the cent; under a cent shows as "<$0.01". */
export function money(n: number) {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
}

/** How long ago a time was, in one short unit ("40s", "3m", "5h", "2d"). */
export function ago(iso: string | null) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** How long something took: seconds to one decimal under a minute, otherwise minutes and seconds. */
export function duration(from: string, to: string | null) {
  if (!to) return '';
  const s = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
