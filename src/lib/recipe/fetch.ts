const HEADERS: HeadersInit = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
};

const MIN_CLEANED_LENGTH = 100;

export async function fetchAndCleanHtml(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    throw new Error(`FETCH_FAILED: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`FETCH_FAILED: ${response.status}`);
  }
  const html = await response.text();
  const cleaned = clean(html);
  if (cleaned.length < MIN_CLEANED_LENGTH) {
    throw new Error('EMPTY_RECIPE');
  }
  return cleaned;
}

function clean(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
