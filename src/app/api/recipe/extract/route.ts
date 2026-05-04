import { NextResponse } from 'next/server';
import { extract } from '~/lib/llm/extract';
import { fetchAndCleanHtml } from '~/lib/recipe/fetch';

type Body = { url?: string; text?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!url && !text) {
    return NextResponse.json({ error: 'url or text is required' }, { status: 400 });
  }
  if (url && !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  try {
    if (url) {
      const html = await fetchAndCleanHtml(url);
      const out = await extract({ html });
      return NextResponse.json(out);
    }
    const out = await extract({ text });
    return NextResponse.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/recipe/extract]', message);
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
