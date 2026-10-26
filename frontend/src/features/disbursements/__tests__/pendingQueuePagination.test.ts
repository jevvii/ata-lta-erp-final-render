import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/lib/api';
import { fetchAllDisbursementsForStatus } from '../api/useDisbursements';
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(), apiRequest: vi.fn(),
}));
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.mocked(apiRequest).mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe('Pending queue page traversal', () => {
  it('retrieves the 5,001st record instead of silently truncating after page 50', async () => {
    vi.mocked(apiRequest).mockImplementation(async (url) => {
      const page = Number(new URLSearchParams(String(url).split('?')[1]).get('page'));
      return {data: Array.from({length: page === 51 ? 1 : 100}, (_, i) => ({id: `${(page - 1) * 100 + i}`})), meta: {total: 5001}};
    });
    const result = await fetchAllDisbursementsForStatus('Submitted');
    expect(result).toHaveLength(5001);
    expect(result[5000]?.id).toBe('5000');
    expect(apiRequest).toHaveBeenCalledTimes(51);
  });
  it('rejects a server that repeats a page rather than hanging or presenting incomplete results', async () => {
    vi.mocked(apiRequest).mockResolvedValue({data: [{id: 'one'}, {id: 'two'}], meta: {total: 5}});
    await expect(fetchAllDisbursementsForStatus('Pending', 2)).rejects.toThrow('no progress');
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
