import { defineStore } from 'pinia';
import { can, type Card, type Engagement, type Permission, type Stage, type User } from '@gh/shared';
import { api, socket } from '../api';

interface Toast { id: number; text: string; kind: 'info' | 'error' }

let initOnce: Promise<void> | null = null;

// Per-browser conveniences. Storage can be blocked, so every access is guarded.
const local = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* this session only */
    }
  },
};
export type Theme = 'system' | 'light' | 'dark';
export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
applyTheme((local.get('gh.theme') as Theme) || 'system');
let wired = false;

export const useApp = defineStore('app', {
  state: () => ({
    engagements: [] as Engagement[],
    engagementId: '' as string,
    cards: [] as Card[],
    slots: { busy: 0, limit: 2 },
    autoStart: true,
    agentStages: [] as Stage[],
    health: { runtime: 'dry-run', model: '', db: '' },
    toasts: [] as Toast[],
    loaded: false,
    user: null as User | null,
    needsSetup: false,
    authChecked: false,
    theme: ((local.get('gh.theme') as Theme) || 'system') as Theme,
    notify: local.get('gh.notify') === 'on',
  }),
  getters: {
    engagement: (s) => s.engagements.find((e) => e.id === s.engagementId) ?? null,
    // An archived engagement is read-only, so its working permissions switch off.
    // Workspace-wide permissions (people, models) are unaffected.
    can: (s) => (p: Permission) => {
      const archived = !!s.engagements.find((e) => e.id === s.engagementId)?.archivedAt;
      if (archived && !['read', 'manage_users', 'manage_models'].includes(p)) return false;
      return can(s.user?.role, p);
    },
    canRaw: (s) => (p: Permission) => can(s.user?.role, p),
    active: (s) => s.engagements.filter((e) => !e.archivedAt),
    archived: (s) => s.engagements.filter((e) => e.archivedAt),
    needsYou: (s) => s.cards.filter((c) => c.status === 'needs_approval' || c.status === 'failed' || (c.stage === 'intake' && c.status === 'idle')),
  },
  actions: {
    async checkAuth() {
      const st = await api('/auth/state');
      this.needsSetup = st.needsSetup;
      this.user = st.user;
      this.authChecked = true;
      if (this.user && !socket.connected) socket.connect();
    },
    signedOut() {
      this.user = null;
      this.loaded = false;
      socket.disconnect();
    },
    // The current engagement's id, loading the workspace first if needed.
    async eid(): Promise<string> {
      if (!this.engagementId) await this.init();
      return this.engagementId;
    },
    init() {
      if (this.loaded) return Promise.resolve();
      initOnce ??= this.load().finally(() => (initOnce = null));
      return initOnce;
    },
    async load() {
      this.engagements = await api('/engagements');
      const saved = local.get('gh.engagement');
      this.engagementId = this.engagements.find((e) => e.id === saved)?.id ?? this.engagements.find((e) => !e.archivedAt)?.id ?? this.engagements[0]?.id ?? '';
      this.health = await api('/health');
      await this.loadBoard();
      if (wired) {
        this.loaded = true;
        return;
      }
      wired = true;
      socket.on('card', (card: Card) => {
        if (!card?.id) return void this.loadBoard();
        if (card.engagementId !== this.engagementId) {
          if (card.status === 'needs_approval') this.alert(card);
          return;
        }
        const i = this.cards.findIndex((c) => c.id === card.id);
        if (card.status === 'needs_approval' && this.cards[i]?.status !== 'needs_approval') this.alert(card);
        if (i >= 0) this.cards.splice(i, 1, card);
        else this.cards.push(card);
        this.slots.busy = this.cards.filter((c) => c.status === 'running').length;
      });
      socket.on('connect', () => void this.loadBoard());
      socket.on('engagement', (e: Engagement) => {
        const i = this.engagements.findIndex((x) => x.id === e.id);
        if (i >= 0) this.engagements.splice(i, 1, e);
        else this.engagements.push(e);
      });
      socket.on('engagement:deleted', ({ id }: { id: string }) => {
        this.engagements = this.engagements.filter((e) => e.id !== id);
        if (this.engagementId === id) void this.switchEngagement(this.engagements.find((e) => !e.archivedAt)?.id ?? '').catch(() => {});
      });
      this.loaded = true;
    },
    async refreshHealth() {
      this.health = await api('/health');
      await this.loadBoard();
    },
    async loadBoard() {
      if (!this.engagementId) return;
      const b = await api(`/engagements/${this.engagementId}/board`);
      this.cards = b.cards;
      this.slots = b.slots;
      this.autoStart = b.autoStart;
      this.agentStages = b.agentStages;
    },
    async switchEngagement(id: string) {
      if (id === this.engagementId) return;
      this.engagementId = id;
      local.set('gh.engagement', id);
      await this.loadBoard();
    },
    async addedEngagement(e: Engagement) {
      if (!this.engagements.some((x) => x.id === e.id)) this.engagements.push(e);
      await this.switchEngagement(e.id);
    },
    setTheme(t: Theme) {
      this.theme = t;
      local.set('gh.theme', t);
      applyTheme(t);
    },
    async setNotify(on: boolean) {
      if (on) {
        if (!('Notification' in window)) return this.toast("This browser doesn't support desktop notifications", 'error');
        const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (p !== 'granted') return this.toast('Notifications are blocked for this site. Allow them in the browser, then try again.', 'error');
      }
      this.notify = on;
      local.set('gh.notify', on ? 'on' : 'off');
    },
    // A card needs a person, this tab is in the background and the person can act on it.
    alert(card: Card) {
      if (!this.notify || !document.hidden || !this.can('approve') || !('Notification' in window) || Notification.permission !== 'granted') return;
      const eng = this.engagements.find((e) => e.id === card.engagementId)?.name ?? '';
      const n = new Notification(`${card.key} needs your approval`, { body: `${card.title}${eng ? ` · ${eng}` : ''}`, tag: card.id });
      n.onclick = () => {
        window.focus();
        location.assign(`/?card=${encodeURIComponent(card.key)}`);
      };
    },
    toast(text: string, kind: Toast['kind'] = 'info') {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, text, kind });
      setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), 4000);
    },
  },
});
