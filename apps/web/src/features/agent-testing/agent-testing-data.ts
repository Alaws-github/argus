// What the Agent testing tabs share: the shape of GET /agent-testing, number formats and the providers
// a person can pick a model from. Split out of AgentTestingPage.vue in v1.7.8.
import { computed } from 'vue';
import type { Calibration, GoldenCase, GoldenRun, JudgeLabel, Provider } from '@gh/shared';

/**
 * What GET /agent-testing returns: golden cases and runs, judge labels, calibrations, the Verifier's
 * settings and trust bar.
 */
export interface AgentTestingData {
  cases: GoldenCase[];
  runs: GoldenRun[];
  labels: JudgeLabel[];
  calibrations: Calibration[];
  verifier: { providerId: string | null; model: string; live: boolean; rulesVersion: string };
  trust: { kappa: number; falsePass: number; minLabels: number };
}

/** A share (0 to 1) as a whole percentage, or a dash when there is none. */
export const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
/** A share (0 to 1) as a whole percentage. */
export const pctOf = (x: number) => `${Math.round(x * 100)}%`;

/** Switched-on providers, and the models of one provider, for the model pickers. */
export function useProviderChoices(providers: () => Provider[]) {
  const enabled = computed(() => providers().filter((p) => p.enabled));
  const modelsFor = (id: string) => providers().find((p) => p.id === id)?.models ?? [];
  return { enabled, modelsFor };
}

/** Where a judge label came from. */
export const LABEL_ORIGIN: Record<string, string> = {
  built_in: 'Built in',
  manual: 'Added by hand',
  decision: "From a reviewer's decision",
};

/** The Verifier's model in words, or "the offline rules". */
export function verifierNameOf(data: AgentTestingData, providers: Provider[]) {
  const v = data.verifier;
  if (!v?.providerId || !v.model) return 'the offline rules';
  return `${v.model} on ${providers.find((p) => p.id === v.providerId)?.name ?? 'a provider'}`;
}
