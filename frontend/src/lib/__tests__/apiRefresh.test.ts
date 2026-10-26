import { afterEach, expect, it, vi } from 'vitest';
import { apiRequest, ApiError, setTokens } from '../api';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('shares a token refresh across concurrent 401 responses and preserves retry HTTP errors', async () => {
  setTokens('old-access', 'old-refresh');
  let resolveRefresh!: (value: Response) => void;
  const refresh = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
  const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).endsWith('/auth/refresh')) return refresh;
    if ((options?.headers as Record<string, string>).Authorization === 'Bearer old-access') return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ detail: 'Missing document' }), { status: 404 });
  });
  const first = apiRequest('/documents/a').catch((error) => error);
  const second = apiRequest('/documents/b').catch((error) => error);
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1));
  resolveRefresh(new Response(JSON.stringify({ data: { accessToken: 'new-access', refreshToken: 'new-refresh' } })));
  const errors = await Promise.all([first, second]);
  for (const error of errors) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).status).toBe(404); }
  expect(localStorage.getItem('erp_access_token')).toBe('new-access');
});
