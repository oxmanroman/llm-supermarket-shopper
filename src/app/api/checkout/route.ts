import { NextResponse } from 'next/server';
import { buildAddToCartUrl } from '~/lib/vtex/cart';
import { STORES, isStoreId } from '~/lib/vtex/stores';

type CheckoutBody = {
  store?: string;
  items?: { skuId?: string; qty?: number }[];
};

export async function POST(request: Request) {
  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!isStoreId(body.store)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }
  const items = (body.items ?? [])
    .filter((i) => typeof i.skuId === 'string' && Number.isInteger(i.qty) && (i.qty as number) > 0)
    .map((i) => ({ skuId: i.skuId as string, qty: i.qty as number }));

  if (items.length === 0) {
    return NextResponse.json({ error: 'no items' }, { status: 400 });
  }

  const redirectUrl = buildAddToCartUrl(STORES[body.store], items);
  return NextResponse.json({ redirectUrl });
}
