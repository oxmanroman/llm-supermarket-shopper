import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export const MODEL_ID = 'anthropic/claude-sonnet-4.5:extended';

export function createLlm() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY: OPENROUTER_API_KEY is not set');
  }
  const openrouter = createOpenRouter({ apiKey });
  return openrouter(MODEL_ID);
}
