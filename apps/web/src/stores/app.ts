import { defineStore } from 'pinia';
import { can, type Card, type Engagement, type Permission, type Stage, type User } from '@gh/shared';
import { api, socket } from '../api';

interface Toast { id: number; text: string; kind: 'info' | 'error' }

let initOnce: Promise<void> | null = null;
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
  }),
  getters: {
    engagement: (s) => s.engagements.find((e) => e.id === s.engagementId) ?? null,
    can: (s) => (p: Permission) => can(s.user?.role, p),
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
      this.engagementId = this.engagements[0]?.id ?? '';
      this.health = await api('/health');
      await this.loadBoard();
      if (wired) {
        this.loaded = true;
        return;
      }
      wired = true;
      socket.on('card', (card: Card) => {
        if (!card?.id) return void this.loadBoard();
        if (card.engagementId !== this.engagementId) return;
        const i = this.cards.findIndex((c) => c.id === card.id);
        if (i >= 0) this.cards.splice(i, 1, card);
        else this.cards.push(card);
        this.slots.busy = this.cards.filter((c) => c.status === 'running').length;
      });
      socket.on('connect', () => void this.loadBoard());
      socket.on('engagement', (e: Engagement) => {
        const i = this.engagements.findIndex((x) => x.id === e.id);
        if (i >= 0) this.engagements.splice(i, 1, e);
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
    toast(text: string, kind: Toast['kind'] = 'info') {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, text, kind });
      setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), 4000);
    },
  },
});
