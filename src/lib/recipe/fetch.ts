// Fetches a recipe URL via Jina's free Reader proxy (https://r.jina.ai/<url>) which
// returns a clean Markdown rendering of the page. Routes the request through Jina's
// infrastructure, so it bypasses Cloudflare bot detection on the source site (our
// server-side `fetch` gets 403'd by some sites that work fine in the user's browser).
// Bonus: Markdown is smaller than raw HTML, which means cheaper LLM extraction.
const JINA_PROXY = 'https://r.jina.ai/';

const MIN_CLEANED_LENGTH = 100;

export async function fetchAndCleanHtml(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${JINA_PROXY}${url}`, {
      headers: { Accept: 'text/plain' },
      redirect: 'follow',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    throw new Error(`FETCH_FAILED: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`FETCH_FAILED: ${response.status}`);
  }
  const text = (await response.text()).trim();
  if (text.length < MIN_CLEANED_LENGTH) {
    throw new Error('EMPTY_RECIPE');
  }
  return text;
}
