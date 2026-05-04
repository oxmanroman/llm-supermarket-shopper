import { NextResponse } from 'next/server';
import { runRecipePipeline } from '~/lib/recipe/pipeline';
import { STORES, isStoreId } from '~/lib/vtex/stores';

type RecipeBody = {
  url?: string;
  store?: string;
  preferences?: string;
};

export async function POST(request: Request) {
  let body: RecipeBody;
  try {
    body = (await request.json()) as RecipeBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!isStoreId(body.store)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }
  if (typeof body.url !== 'string' || !/^https?:\/\//i.test(body.url)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  try {
    const result = await runRecipePipeline({
      url: body.url,
      store: STORES[body.store],
      preferences: typeof body.preferences === 'string' ? body.preferences : '',
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/recipe]', message);
    if (message.startsWith('FETCH_FAILED')) {
      return NextResponse.json({ error: 'FETCH_FAILED', detail: message }, { status: 502 });
    }
    if (message.startsWith('EMPTY_RECIPE')) {
      return NextResponse.json({ error: 'EMPTY_RECIPE' }, { status: 422 });
    }
    if (message.startsWith('MISSING_API_KEY')) {
      return NextResponse.json({ error: 'MISSING_API_KEY' }, { status: 500 });
    }
    if (message.startsWith('LLM_FAILED')) {
      return NextResponse.json({ error: 'LLM_FAILED', detail: message }, { status: 502 });
    }
    return NextResponse.json({ error: 'UNKNOWN', detail: message }, { status: 500 });
  }
}
