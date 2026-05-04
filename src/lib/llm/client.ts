import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// Anthropic models with id ending >= 4.5 (Sonnet) or >= 4.6 (Opus) have 1M context
// natively on OpenRouter — no `:extended` suffix needed. The suffix is only used for
// older models that have an opt-in extended-context tier.
export const MODEL_ID = 'anthropic/claude-sonnet-4.6';

export function createLlm() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY: OPENROUTER_API_KEY is not set');
  }
  const openrouter = createOpenRouter({ apiKey });
  return openrouter(MODEL_ID);
}
