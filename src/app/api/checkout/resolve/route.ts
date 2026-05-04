import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolve } from '~/lib/checkout/resolve';
import { STORES, isStoreId } from '~/lib/vtex/stores';
import { RecipeSchema } from '~/types/plan';

const BodySchema = z.object({
  store: z.string(),
  recipes: z.array(RecipeSchema),
  preferences: z.string(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', detail: parsed.error.issues }, { status: 400 });
  }
  if (!isStoreId(parsed.data.store)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }

  try {
    const result = await resolve({
      store: STORES[parsed.data.store],
      recipes: parsed.data.recipes,
      preferences: parsed.data.preferences,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/checkout/resolve]', message);
    if (message.startsWith('MISSING_API_KEY')) {
      return NextResponse.json({ error: 'MISSING_API_KEY' }, { status: 500 });
    }
    if (message.startsWith('LLM_FAILED')) {
      return NextResponse.json({ error: 'LLM_FAILED', detail: message }, { status: 502 });
    }
    return NextResponse.json({ error: 'UNKNOWN', detail: message }, { status: 500 });
  }
}
