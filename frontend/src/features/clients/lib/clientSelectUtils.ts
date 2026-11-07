export interface ClientSelectItemLike {
  id: string;
  name: string;
  entity?: string | null;
  tin?: string | null;
  rdoCode?: string | null;
  rdo_code?: string | null;
  tradeName?: string | null;
  trade_name?: string | null;
  clientNumber?: string | null;
  client_number?: string | null;
}

export function getClientTradeName(client?: ClientSelectItemLike | null): string | null {
  if (!client) return null;
  const raw = (client.tradeName ?? client.trade_name ?? '').trim();
  if (!raw) return null;
  if (raw.toLowerCase() === (client.name ?? '').trim().toLowerCase()) return null;
  return raw;
}

export function getClientNumber(client?: ClientSelectItemLike | null): string | null {
  if (!client) return null;
  const raw = (client.clientNumber ?? client.client_number ?? '').trim();
  return raw || null;
}

export function getClientTin(client?: ClientSelectItemLike | null): string | null {
  if (!client) return null;
  const raw = (client.tin ?? '').trim();
  return raw || null;
}

export function getClientRdo(client?: ClientSelectItemLike | null): string | null {
  if (!client) return null;
  const raw = (client.rdoCode ?? client.rdo_code ?? '').trim();
  return raw || null;
}

/**
 * Returns a Set of client IDs whose normalized `name` or `tradeName` collides
 * with at least one other client's normalized `name` or `tradeName` in the list.
 */
export function getDuplicateClientIds<T extends ClientSelectItemLike>(clients: T[]): Set<string> {
  const keyCounts = new Map<string, string[]>();
  const addKey = (key: string, id: string) => {
    const norm = key.trim().toLowerCase();
    if (!norm) return;
    const list = keyCounts.get(norm) ?? [];
    if (!list.includes(id)) list.push(id);
    keyCounts.set(norm, list);
  };
  for (const c of clients) {
    if (!c || !c.id) continue;
    if (c.name) addKey(c.name, c.id);
    const dba = c.tradeName ?? c.trade_name;
    if (dba) addKey(dba, c.id);
  }
  const duplicates = new Set<string>();
  for (const ids of keyCounts.values()) {
    if (ids.length > 1) {
      for (const id of ids) duplicates.add(id);
    }
  }
  return duplicates;
}

/**
 * Matches a client against a search query by checking:
 * - Client Name
 * - TIN (both formatted with hyphens e.g. `123-456-789-00001` and digits-only e.g. `00001` or `12345678900001`)
 * - Trade Name / DBA
 * - Client Number (e.g. `C-0001`)
 * - Entity (if present)
 */
export function matchesClientSearch(client: ClientSelectItemLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (client.name ?? '').toLowerCase();
  const dba = (client.tradeName ?? client.trade_name ?? '').toLowerCase();
  const clientNum = (client.clientNumber ?? client.client_number ?? '').toLowerCase();
  const tin = (client.tin ?? '').toLowerCase();
  const tinDigits = tin.replace(/\D/g, '');
  const qDigits = q.replace(/\D/g, '');
  const entity = (client.entity ?? '').toLowerCase();

  if (name.includes(q)) return true;
  if (dba && dba.includes(q)) return true;
  if (clientNum && clientNum.includes(q)) return true;
  if (tin && tin.includes(q)) return true;
  if (qDigits.length >= 2 && tinDigits.includes(qDigits)) return true;
  if (entity && entity.includes(q)) return true;
  return false;
}

/**
 * Formats the auto-detected read-only client display (e.g. in CreateDisbursementModal).
 * Always appends `• TIN {tin}` when a TIN is present.
 */
export function formatAutoDetectedClientDisplay(
  client?: ClientSelectItemLike | null,
  fallbackName?: string | null
): string {
  const name = (client?.name ?? fallbackName ?? '').trim();
  if (!name) return '';
  const tin = getClientTin(client);
  return tin ? `${name} • TIN ${tin}` : name;
}

export type ClientSortOption =
  | 'id_asc'
  | 'id_desc'
  | 'name_asc'
  | 'name_desc'
  | 'tin_asc'
  | 'tin_desc'
  | 'rdo_asc'
  | 'rdo_desc';

export const DEFAULT_CLIENT_SORT: ClientSortOption = 'id_asc';

export const CLIENT_SORT_OPTIONS: ReadonlyArray<{ value: ClientSortOption; label: string }> = [
  { value: 'id_asc', label: 'ID (0→9)' },
  { value: 'id_desc', label: 'ID (9→0)' },
  { value: 'name_asc', label: 'Name (A→Z)' },
  { value: 'name_desc', label: 'Name (Z→A)' },
  { value: 'tin_asc', label: 'TIN (0→9)' },
  { value: 'tin_desc', label: 'TIN (9→0)' },
  { value: 'rdo_asc', label: 'RDO (0→9)' },
  { value: 'rdo_desc', label: 'RDO (9→0)' },
];

export function sortClients<T extends ClientSelectItemLike>(
  clients: readonly T[],
  sortBy: ClientSortOption = DEFAULT_CLIENT_SORT
): T[] {
  return [...clients].sort((a, b) => {
    if (sortBy === 'id_asc' || sortBy === 'id_desc') {
      const aNum = getClientNumber(a);
      const bNum = getClientNumber(b);
      const mult = sortBy === 'id_asc' ? 1 : -1;

      // If only one has clientNumber: the one with clientNumber ALWAYS comes first
      if (aNum && !bNum) return -1;
      if (!aNum && bNum) return 1;

      if (aNum && bNum) {
        const cmp = aNum.localeCompare(bNum, undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return mult * cmp;
        return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' });
      }

      // If neither has clientNumber: compare (a.id ?? '') vs (b.id ?? '')
      const idCmp = (a.id ?? '').localeCompare(b.id ?? '', undefined, { numeric: true, sensitivity: 'base' });
      if (idCmp !== 0) return mult * idCmp;
      return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' });
    }

    if (sortBy === 'name_asc' || sortBy === 'name_desc') {
      const mult = sortBy === 'name_asc' ? 1 : -1;
      const cmp = (a.name ?? '').trim().localeCompare((b.name ?? '').trim(), undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return mult * cmp;
      const aId = getClientNumber(a) ?? a.id ?? '';
      const bId = getClientNumber(b) ?? b.id ?? '';
      return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' });
    }

    if (sortBy === 'tin_asc' || sortBy === 'tin_desc') {
      const aTin = getClientTin(a);
      const bTin = getClientTin(b);
      const mult = sortBy === 'tin_asc' ? 1 : -1;

      // If only one has tin: the one with tin ALWAYS comes first
      if (aTin && !bTin) return -1;
      if (!aTin && bTin) return 1;

      if (aTin && bTin) {
        const cmp = aTin.localeCompare(bTin, undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return mult * cmp;
      }
      return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' });
    }

    if (sortBy === 'rdo_asc' || sortBy === 'rdo_desc') {
      const aRdo = getClientRdo(a);
      const bRdo = getClientRdo(b);
      const mult = sortBy === 'rdo_asc' ? 1 : -1;

      // If only one has RDO: the one with RDO ALWAYS comes first (missing goes last in both)
      if (aRdo && !bRdo) return -1;
      if (!aRdo && bRdo) return 1;

      if (aRdo && bRdo) {
        const cmp = aRdo.localeCompare(bRdo, undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return mult * cmp;
      }
      return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' });
    }

    return 0;
  });
}
