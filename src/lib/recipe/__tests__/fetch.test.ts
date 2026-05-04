/**
 * @jest-environment node
 */
import { fetchAndCleanHtml } from '../fetch';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

describe('fetchAndCleanHtml', () => {
  it('returns cleaned text content with scripts and styles removed', async () => {
    const html = `<html><head>
        <script>var x = 1;</script>
        <style>.a{color:red}</style>
        <title>Recipe</title>
      </head><body>
        <h1>Pasta carbonara</h1>
        <ul><li>200g pasta</li><li>2 huevos</li></ul>
        <script>tracking()</script>
      </body></html>`;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }));

    const cleaned = await fetchAndCleanHtml('https://example.test/recipe');

    expect(cleaned).not.toContain('var x = 1');
    expect(cleaned).not.toContain('color:red');
    expect(cleaned).toContain('Pasta carbonara');
    expect(cleaned).toContain('200g pasta');
    expect(cleaned).toContain('2 huevos');
  });

  it('throws FETCH_FAILED on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    await expect(fetchAndCleanHtml('https://example.test/missing')).rejects.toThrow(/FETCH_FAILED.*404/);
  });

  it('throws FETCH_FAILED on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(fetchAndCleanHtml('https://nope.test/x')).rejects.toThrow(/FETCH_FAILED/);
  });

  it('throws EMPTY_RECIPE if cleaned content is < 500 chars', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html><body>tiny</body></html>', { status: 200 }));
    await expect(fetchAndCleanHtml('https://example.test/empty')).rejects.toThrow(/EMPTY_RECIPE/);
  });

  it('uses a browser-like User-Agent header', async () => {
    const big = `<html><body>${'pasta '.repeat(200)}</body></html>`;
    mockFetch.mockResolvedValueOnce(new Response(big, { status: 200 }));
    await fetchAndCleanHtml('https://example.test/x');
    const call = mockFetch.mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/Mozilla/);
  });
});
