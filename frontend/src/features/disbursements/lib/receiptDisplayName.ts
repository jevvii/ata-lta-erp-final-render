/** Only show a file name, never a bucket path or generated upload identifier. */
export function receiptDisplayName(value?: string | null): string {
  const basename = value?.replace(/\\/g, '/').split('/').pop()?.split(/[?#]/)[0];
  return (
    basename
      ?.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i, '')
      .trim() || 'Receipt'
  );
}
