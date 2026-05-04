/**
 * @jest-environment node
 */
import { fetchAndCleanHtml } from '../fetch';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

describe('fetchAndCleanHtml', () => {
  it('routes the request through r.jina.ai with the source URL appended', async () => {
    const markdown = `# Empanadas de pollo\n\n## Ingredientes\n- 200 g de pollo\n- 1 cebolla\n- masa para empanadas\n\n## Preparación\n${'paso '.repeat(50)}`;
    mockFetch.mockResolvedValueOnce(new Response(markdown, { status: 200 }));

    const cleaned = await fetchAndCleanHtml('https://alicante.com.ar/receta/empanadas');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://r.jina.ai/https://alicante.com.ar/receta/empanadas',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(cleaned).toContain('Empanadas de pollo');
    expect(cleaned).toContain('200 g de pollo');
  });

  it('throws FETCH_FAILED when the proxy returns non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(fetchAndCleanHtml('https://example.test/x')).rejects.toThrow(/FETCH_FAILED.*429/);
  });

  it('throws FETCH_FAILED on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(fetchAndCleanHtml('https://nope.test/x')).rejects.toThrow(/FETCH_FAILED/);
  });

  it('throws EMPTY_RECIPE if the proxy returned barely anything', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Title: x\n', { status: 200 }));
    await expect(fetchAndCleanHtml('https://example.test/empty')).rejects.toThrow(/EMPTY_RECIPE/);
  });
});
