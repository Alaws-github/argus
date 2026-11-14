// Model prices and run cost. Cost = tokens x the price per million tokens set
// on the Models page. Unbilled providers always cost $0.
import type { ModelPrice } from '@gh/shared';

// Default USD prices per million tokens for Anthropic models, the same table
// GoldenEye ships. A provider's own prices (Models & keys) override these.
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, cached: 0.25, output: 50 },
  'claude-opus-5-5': { input: 4, cached: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cached: 0.2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, cached: 0.01, output: 0.5 },
};

/** The price of a model on a provider, matched by name, or null. */
export function priceFor(model: string, prices: Record<string, ModelPrice>): ModelPrice | null {
  return prices[model] ?? DEFAULT_PRICES[model] ?? null;
}

/** What a call cost in US dollars, from the tokens used and the price (cached input at its own rate). */
export function costUsd(price: ModelPrice | null, tokensIn: number, tokensOut: number, tokensCached = 0) {
  if (!price) return 0;
  return (tokensIn * price.input + tokensCached * price.cached + tokensOut * price.output) / 1_000_000;
}
