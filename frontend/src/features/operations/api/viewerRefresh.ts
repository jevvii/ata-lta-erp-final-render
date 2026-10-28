/** Authorized HTTP fallback when realtime delivery is unavailable or filtered by RLS. */
const isAccessDenied = (error: unknown): boolean =>
  [401, 403, 404].includes((error as { status?: number } | null)?.status ?? 0);

export const operationsViewerRefresh = {
  refetchInterval: (query: { state: { error: Error | null } }): number | false =>
    isAccessDenied(query.state.error) ? false : 8000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: 'always' as const,
  refetchOnReconnect: 'always' as const,
};
