import type { VtexStore } from '~/lib/store/types';

const HEADERS: HeadersInit = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9',
};

export async function vtexFetch(store: VtexStore, path: string): Promise<Response> {
  const url = `${store.baseUrl}${path}`;
  const response = await fetch(url, {
    headers: { ...HEADERS, Referer: `${store.baseUrl}/` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`VTEX ${store.id} ${response.status} on ${path}`);
  }
  return response;
}
