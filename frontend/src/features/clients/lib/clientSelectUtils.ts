export interface ClientSelectItemLike {
  id: string;
  name: string;
  entity?: string | null;
  tin?: string | null;
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
