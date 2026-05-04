import { NextResponse } from 'next/server';
import { productSearch } from '~/lib/vtex/search';
import { STORES, isStoreId } from '~/lib/vtex/stores';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeParam = searchParams.get('store');
  const q = searchParams.get('q')?.trim() ?? '';

  if (!isStoreId(storeParam)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }
  if (!q) {
    return NextResponse.json({ products: [] });
  }

  try {
    const products = await productSearch(STORES[storeParam], q);
    return NextResponse.json({ products });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/search]', message);
    const upstreamBlocked = /403/.test(message);
    return NextResponse.json(
      { error: upstreamBlocked ? 'CF_BLOCKED' : 'UPSTREAM_ERROR', detail: message },
      { status: 502 },
    );
  }
}
