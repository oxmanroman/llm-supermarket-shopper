// Surfaces the most useful detail from an AI-SDK error so server logs and 502
// responses say something more actionable than "Provider returned error".
export function describeLlmError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const e = error as Error & {
    responseBody?: unknown;
    data?: unknown;
    cause?: unknown;
  };
  const parts: string[] = [e.message];
  const extras = [e.responseBody, e.data, (e.cause as Error | undefined)?.message];
  for (const x of extras) {
    if (!x) continue;
    const asString = typeof x === 'string' ? x : safeStringify(x);
    if (asString && !parts.some((p) => p.includes(asString.slice(0, 60)))) {
      parts.push(asString.slice(0, 400));
    }
  }
  return parts.join(' | ');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
