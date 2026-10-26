/**
 * Mock Supabase admin client for integration tests.
 * Allows tests to register fake users and audit expectations.
 * Supports the atomic RPC transitions introduced by the concurrency hardening plan.
 */

try {
  const mime = require('mime');
  if (mime && typeof mime.getType !== 'function' && typeof mime.lookup === 'function') {
    mime.getType = (path) => mime.lookup(path);
  }
} catch (_) {
  // mime compatibility shim optional
}

const mockUsers = new Map();
const mockTokens = new Map();
const mockTables = {
  entities: new Map(),
  departments: new Map(),
  users: new Map(),
  user_departments: new Map(),
  audit_logs: new Map(),
  clients: new Map(),
  client_contact_details: new Map(),
  client_related_companies: new Map(),
  work_requests: new Map(),
  tasks: new Map(),
  task_checklists: new Map(),
  task_time_logs: new Map(),
  task_assignees: new Map(),
  time_entries: new Map(),
  pending_changes: new Map(),
  operations_requests: new Map(),
  invoices: new Map(),
  invoice_line_items: new Map(),
  invoice_payments: new Map(),
  billing_templates: new Map(),
  disbursements: new Map(),
  transmittals: new Map(),
  transmittal_items: new Map(),
  documents: new Map(),
  disbursement_templates: new Map(),
  retainer_templates: new Map(),
  retainer_template_generations: new Map(),
  ground_workers: new Map(),
  standard_task_templates: new Map(),
  task_templates: new Map(),
  idempotency_keys: new Map(),
  status_history: new Map(),
  document_sequences: new Map(),
  notifications: new Map(),
};

const mockStorageObjects = new Map();

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `mock-${sequence}`;
};

// Tables carrying `version integer NOT NULL DEFAULT 1` (migration 000031).
// Postgres applies the DEFAULT on INSERT even when the column is omitted;
// the mock mirrors that so OCC guards (`eq('version', n)`) behave the same
// here as they would against the live database.
const VERSIONED_TABLES = new Set([
  'clients',
  'invoices',
  'invoice_line_items',
  'disbursements',
  'transmittals',
  'transmittal_items',
  'work_requests',
  'tasks',
  'operations_requests',
  'pending_changes',
  'documents',
]);

const TABLE_COLUMNS = {
  pending_changes: new Set([
    'id',
    'entity_id',
    'table_name',
    'parent_record_id',
    'proposed_data',
    'submitted_by',
    'status',
    'rejection_reason',
    'reviewed_by',
    'reviewed_at',
    'created_at',
    'version',
  ]),
};

const nowIso = () => new Date().toISOString();

/**
 * Seed the entities and departments required by most tests.
 */
const seedDefaults = () => {
  mockTables.entities.set('ent-ata', { id: 'ent-ata', code: 'ATA', name: 'ATA Accounting Firm' });
  mockTables.entities.set('ent-lta', { id: 'ent-lta', code: 'LTA', name: 'LTA Accounting Firm' });

  const depts = ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'];
  depts.forEach((name, idx) => {
    const id = `dept-${idx + 1}`;
    mockTables.departments.set(id, { id, name });
  });
};

/**
 * Register a fake user that the auth middleware will accept.
 * @param {Object} user
 * @returns {string} bearer token
 */
const registerUser = (user) => {
  const token = `token-${user.email}`;
  const id = user.id || nextId();
  const record = {
    id,
    auth_user_id: user.authUserId || id,
    email: user.email,
    password: user.password || 'oldpass',
    name: user.name,
    role: user.role,
    entities: user.entities || ['ATA'],
    is_active: user.isActive !== false,
    avatar_url: user.avatarUrl || null,
    preferences: user.preferences || {},
    password_updated_at: user.passwordUpdatedAt || null,
  };
  if (Array.isArray(user.departments)) {
    record.user_departments = user.departments.map((deptName) => ({
      departments: { name: deptName },
    }));
  }
  mockUsers.set(token, record);
  mockTokens.set(record.auth_user_id, token);
  mockTables.users.set(id, record);
  return token;
};

/**
 * Build a chainable query builder for a given table.
 * @param {string} table
 */
const tableQuery = (table) => {
  const rows = mockTables[table] || new Map();
  const filters = [];
  const orders = [];
  let limit = null;
  let op = 'select';
  let countOptions = null;
  let insertRecords = null;
  let updateValues = null;

  const splitTopLevel = (str) => {
    const parts = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '(' || char === '{') depth++;
      else if (char === ')' || char === '}') depth--;
      if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };

  const matchFilter = (row, filter) => {
    const { column, value, op: fop = 'eq', innerOp } = filter;
    if (fop === 'and') {
      return (filter.parts || []).every((p) => matchFilter(row, p));
    }
    if (fop === 'or') {
      return (filter.parts || []).some((p) => matchFilter(row, p));
    }
    const rowValue = row[column];
    if (fop === 'not') {
      return !matchFilter(row, { column, value, op: innerOp || 'eq' });
    }
    if (fop === 'is') {
      return value === null ? rowValue === null || rowValue === undefined : rowValue === value;
    }
    if (fop === 'in') {
      const arr = Array.isArray(value) ? value : [value];
      return arr.includes(rowValue);
    }
    if (fop === 'cs') {
      const rowArr = Array.isArray(rowValue) ? rowValue : [];
      const checkVals = Array.isArray(value) ? value : [value];
      return checkVals.some((v) => rowArr.includes(v));
    }
    if (fop === 'neq') {
      return rowValue !== value;
    }
    // Ordered comparisons: numeric when both sides are numeric, otherwise
    // lexicographic — ISO date/timestamp strings order correctly as strings,
    // matching Postgres semantics for date columns.
    const cmp = (a, b) => {
      if (a === null || a === undefined) return null;
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    };
    if (fop === 'gt') {
      const c = cmp(rowValue, value);
      return c !== null && c > 0;
    }
    if (fop === 'gte') {
      const c = cmp(rowValue, value);
      return c !== null && c >= 0;
    }
    if (fop === 'lt') {
      const c = cmp(rowValue, value);
      return c !== null && c < 0;
    }
    if (fop === 'lte') {
      const c = cmp(rowValue, value);
      return c !== null && c <= 0;
    }
    if (fop === 'ilike') {
      if (rowValue === null || rowValue === undefined) return false;
      const pattern = value.replace(/^%|%$/g, '');
      return String(rowValue).toLowerCase().includes(pattern.toLowerCase());
    }
    if (Array.isArray(rowValue)) return rowValue.includes(value);
    return rowValue === value;
  };

  const parseOrPart = (part) => {
    const andM = part.match(/^and\((.*)\)$/);
    if (andM) {
      const subParts = splitTopLevel(andM[1]);
      return { op: 'and', parts: subParts.map(parseOrPart).filter(Boolean) };
    }
    const orM = part.match(/^or\((.*)\)$/);
    if (orM) {
      const subParts = splitTopLevel(orM[1]);
      return { op: 'or', parts: subParts.map(parseOrPart).filter(Boolean) };
    }
    const notIsM = part.match(/^([^.]+)\.not\.is\.null$/);
    if (notIsM) {
      return { column: notIsM[1], value: null, op: 'not', innerOp: 'is' };
    }
    const isM = part.match(/^([^.]+)\.is\.null$/);
    if (isM) {
      return { column: isM[1], value: null, op: 'is' };
    }
    const notM = part.match(/^([^.]+)\.not\.([^.]+)\.%?(.+)%?$/);
    if (notM) {
      let val = notM[3];
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      return { column: notM[1], value: val, op: 'not', innerOp: notM[2] };
    }
    const m = part.match(/^([^.]+)\.([^.]+)\.%?(.+)%?$/);
    if (!m) return null;
    const col = m[1];
    const fop = m[2];
    let val = m[3];
    if (fop === 'in' && val.startsWith('(') && val.endsWith(')')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim());
    } else if (fop === 'cs' && val.startsWith('{') && val.endsWith('}')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim());
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    }
    return { column: col, value: val, op: fop };
  };

  const applyFilters = () => {
    return Array.from(rows.values()).filter((row) =>
      filters.every((filter) => {
        if (filter.op === 'or') {
          return filter.parts.some((part) => {
            const parsed = typeof part === 'string' ? parseOrPart(part) : part;
            if (!parsed) return false;
            return matchFilter(row, parsed);
          });
        }
        return matchFilter(row, filter);
      })
    );
  };

  const execute = () => {
    let result = applyFilters();

    if (op === 'delete') {
      result.forEach((row) => rows.delete(row.id));
      return result;
    }

    if (op === 'update') {
      result.forEach((row) => {
        Object.assign(row, updateValues);
      });
      return result;
    }

    if (op === 'insert') {
      if (builder._insertError) {
        return [];
      }
      const inserted = [];
      insertRecords.forEach((rec) => {
        const id = rec.id || nextId();
        const stored = { ...rec, id };
        if (VERSIONED_TABLES.has(table) && stored.version === undefined) {
          stored.version = 1;
        }
        if (table === 'retainer_templates' && stored.template_type === undefined) {
          stored.template_type = 'retainer';
        }
        if (table === 'disbursements' && stored.lifecycle_version === 2) {
          const histId = nextId();
          mockTables.status_history.set(histId, {
            id: histId,
            table_name: 'disbursements',
            record_id: id,
            old_status: null,
            new_status: stored.status || 'Draft',
            actor_id: stored.created_by,
            entity_id: stored.entity_id,
            details: {
              action: 'create',
              amount: stored.amount,
              category: stored.category,
              description: stored.description,
              disbursement_number: stored.disbursement_number,
              review_ready: stored.review_ready,
              lifecycle_version: stored.lifecycle_version,
              receipt_filename: stored.receipt_filename,
              receipt_s3_key: stored.receipt_s3_key,
            },
            created_at: stored.created_at || nowIso(),
          });
        }
        rows.set(id, stored);
        inserted.push(stored);
      });
      return inserted;
    }

    if (orders.length > 0) {
      result.sort((a, b) => {
        for (const ord of orders) {
          const aVal = a[ord.column];
          const bVal = b[ord.column];
          if (aVal === null || aVal === undefined || bVal === null || bVal === undefined) continue;
          if (aVal < bVal) return ord.ascending ? -1 : 1;
          if (aVal > bVal) return ord.ascending ? 1 : -1;
        }
        return 0;
      });
    }

    if (limit) result = result.slice(0, limit);
    if (builder._postFilters) {
      builder._postFilters.forEach((fn) => {
        result = fn(result);
      });
    }
    return result;
  };

  const builder = {
    select: (_columns, options = {}) => {
      if (table === 'tasks' && _columns) {
        const cols = String(_columns).split(',').map((x) => x.trim());
        if (cols.includes('entity_id')) {
          builder._queryError = {
            code: '42703',
            message: 'column tasks.entity_id does not exist',
          };
        }
      }
      if (options.count) {
        countOptions = options;
      }
      return builder;
    },
    eq: (column, value) => {
      const known = TABLE_COLUMNS[table];
      if (known && !known.has(column)) {
        builder._queryError = {
          message: `column "${column}" does not exist`,
          code: '42703',
        };
      }
      filters.push({ column, value });
      return builder;
    },
    in: (column, values) => {
      filters.push({ column, value: values, op: 'in' });
      return builder;
    },
    is: (column, value) => {
      filters.push({ column, value, op: 'is' });
      return builder;
    },
    order: (column, { ascending = true } = {}) => {
      orders.push({ column, ascending });
      return builder;
    },
    limit: (n) => {
      limit = n;
      return builder;
    },
    range: (from, to) => {
      if (!builder._postFilters) builder._postFilters = [];
      builder._postFilters.push((result) => result.slice(from, to + 1));
      return builder;
    },
    gt: (column, value) => {
      filters.push({ column, value, op: 'gt' });
      return builder;
    },
    gte: (column, value) => {
      filters.push({ column, value, op: 'gte' });
      return builder;
    },
    lte: (column, value) => {
      filters.push({ column, value, op: 'lte' });
      return builder;
    },
    lt: (column, value) => {
      filters.push({ column, value, op: 'lt' });
      return builder;
    },
    not: (column, op, value) => {
      filters.push({ column, value, op: 'not', innerOp: op });
      return builder;
    },
    ilike: (column, value) => {
      filters.push({ column, value, op: 'ilike' });
      return builder;
    },
    neq: (column, value) => {
      filters.push({ column, value, op: 'neq' });
      return builder;
    },
    or: (expression) => {
      const parts = splitTopLevel(expression);
      filters.push({ op: 'or', parts });
      return builder;
    },
    insert: (records) => {
      op = 'insert';
      insertRecords = Array.isArray(records) ? records : [records];

      for (const rec of insertRecords) {
        const id = rec.id || nextId();
        const stored = { ...rec, id };

        // Simulate unique constraints for concurrency-safety tests.
        if (table === 'clients' && stored.tin) {
          const dup = Array.from(rows.values()).find(
            (r) => r.entity_id === stored.entity_id && r.tin === stored.tin && !r.deleted_at
          );
          if (dup) {
            builder._insertError = {
              message: 'duplicate key value violates unique constraint "clients_entity_id_tin_key"',
              code: '23505',
            };
            return builder;
          }
        }
        if (table === 'invoices' && stored.invoice_number) {
          const dup = Array.from(rows.values()).find(
            (r) => r.entity_id === stored.entity_id && r.invoice_number === stored.invoice_number
          );
          if (dup) {
            builder._insertError = {
              message:
                'duplicate key value violates unique constraint "invoices_entity_id_invoice_number_key"',
              code: '23505',
            };
            return builder;
          }
        }
        if (table === 'disbursements' && stored.disbursement_number) {
          const dup = Array.from(rows.values()).find(
            (r) =>
              r.entity_id === stored.entity_id &&
              r.disbursement_number === stored.disbursement_number
          );
          if (dup) {
            builder._insertError = {
              message:
                'duplicate key value violates unique constraint "disbursements_entity_id_disbursement_number_key"',
              code: '23505',
            };
            return builder;
          }
        }
        if (table === 'retainer_template_generations' && stored.template_id && stored.period_label) {
          const dup = Array.from(rows.values()).find(
            (r) =>
              r.template_id === stored.template_id &&
              r.period_label === stored.period_label
          );
          if (dup) {
            builder._insertError = {
              message:
                'duplicate key value violates unique constraint "uq_retainer_template_generations_period"',
              code: '23505',
            };
            return builder;
          }
        }
      }

      return builder;
    },
    update: (updates) => {
      op = 'update';
      updateValues = updates;
      return builder;
    },
    delete: () => {
      op = 'delete';
      return builder;
    },
    maybeSingle: () => {
      if (builder._queryError) {
        return Promise.resolve({ data: null, error: builder._queryError });
      }
      if (builder._insertError) {
        return Promise.resolve({ data: null, error: builder._insertError });
      }
      if (builder._queryError) {
        return Promise.resolve({ data: null, error: builder._queryError });
      }
      const result = execute();
      return Promise.resolve({ data: result[0] || null, error: null });
    },
    single: () => {
      if (builder._queryError) {
        return Promise.resolve({ data: null, error: builder._queryError });
      }
      if (builder._insertError) {
        return Promise.resolve({ data: null, error: builder._insertError });
      }
      if (builder._queryError) {
        return Promise.resolve({ data: null, error: builder._queryError });
      }
      const result = execute();
      if (result.length === 0) {
        return Promise.resolve({ data: null, error: { message: 'No rows found' } });
      }
      return Promise.resolve({ data: result[0], error: null });
    },
    count: (options = {}) => {
      if (builder._queryError) {
        return Promise.resolve({ data: null, count: null, error: builder._queryError });
      }
      if (builder._insertError) {
        return Promise.resolve({ data: null, error: builder._insertError });
      }
      if (builder._queryError) {
        return Promise.resolve({ data: null, error: builder._queryError });
      }
      const result = execute();
      const count = result.length;
      if (options.head) {
        return Promise.resolve({ data: null, count, error: null });
      }
      return Promise.resolve({ data: [{ count }], count, error: null });
    },
    then: (resolve) => {
      if (builder._queryError) {
        return Promise.resolve({ data: null, count: null, error: builder._queryError }).then(resolve);
      }
      if (builder._insertError) {
        return Promise.resolve({ data: null, error: builder._insertError }).then(resolve);
      }
      if (builder._queryError) {
        return Promise.resolve({ data: null, error: builder._queryError }).then(resolve);
      }
      const result = execute();
      const response = { data: result, error: null };
      if (countOptions) {
        response.count = result.length;
        if (countOptions.head) {
          response.data = null;
        }
      }
      return Promise.resolve(response).then(resolve);
    },
  };

  return builder;
};

/**
 * Atomic RPC transition helpers for concurrency tests.
 */
const rpcImpl = {
  mutate_document_comment: (p) => {
    const fail = (code, message) => ({ data: null, error: { code, message } });
    const doc = mockTables.documents.get(p.p_document_id);
    if (!doc || doc.entity_id !== p.p_entity_id || doc.deleted_at) return fail('P0002', 'Document not found');
    const actor = mockTables.users.get(p.p_user_id);
    if (!actor?.is_active) return fail('42501', 'Active user required');
    const comments = [...(doc.comments || [])];
    if (p.p_action === 'add') {
      comments.push({ id: require('crypto').randomUUID(), userId: actor.id,
        userName: actor.name, date: nowIso(), text: p.p_text.trim() });
    } else {
      const index = comments.findIndex((c) => c.id === p.p_comment_id);
      if (index < 0) return fail('P0002', 'Comment not found');
      const target = comments[index];
      if ((target.userId || target.user_id) !== actor.id && !(p.p_action === 'delete' && actor.role === 'Admin')) {
        return fail('42501', 'You cannot modify this comment');
      }
      if (p.p_action === 'delete') comments.splice(index, 1);
      else comments[index] = { ...target, text: p.p_text.trim(), edited: true, edited_at: nowIso() };
    }
    Object.assign(doc, { comments, updated_by: actor.id, updated_at: nowIso() });
    return { data: JSON.parse(JSON.stringify(doc)), error: null };
  },
  disbursement_transition: (params) => {
    const row = mockTables.disbursements.get(params.p_id);
    if (!row) return { data: [], error: null };
    if (row.entity_id !== params.p_entity_id) return { data: [], error: null };

    if (row.lifecycle_version === 2) {
      if (
        params.p_expected_version === null ||
        params.p_expected_version === undefined ||
        Number(params.p_expected_version) <= 0
      ) {
        return { data: null, error: { message: 'VERSION_REQUIRED', code: 'P0001' } };
      }
      if (row.version !== Number(params.p_expected_version)) {
        return { data: null, error: { message: 'ERR_CONCURRENCY_CONFLICT', code: 'P0001' } };
      }
    } else if (
      params.p_expected_version !== null &&
      params.p_expected_version !== undefined &&
      row.version !== Number(params.p_expected_version)
    ) {
      return { data: [], error: null };
    }

    const actor = mockTables.users.get(params.p_user_id);
    const isAdmin = actor?.role === 'Admin';
    const isAccounting =
      actor?.role === 'Accounting' ||
      (actor?.user_departments || []).some((d) => (d.departments?.name || '').toLowerCase() === 'accounting');

    const fromStatuses = Array.isArray(params.p_from_statuses)
      ? params.p_from_statuses
      : [params.p_from_statuses];
    if (!fromStatuses.includes(row.status)) return { data: [], error: null };

    const oldStatus = row.status;
    const now = nowIso();

    if (params.p_to_status === 'Approved') {
      if (!isAdmin) {
        return { data: null, error: { message: 'FORBIDDEN_ROLE_NOT_ADMIN', code: '42501' } };
      }
      row.approved_by = params.p_user_id;
      row.approved_at = now;
    } else if (params.p_to_status === 'Funded') {
      if (!isAdmin && !isAccounting) {
        return { data: null, error: { message: 'FORBIDDEN_FUNDING_PERMISSION', code: '42501' } };
      }
      const pd = params.p_payment_details || {};
      if (!pd.method || !pd.bank || !pd.reference || !pd.date) {
        return { data: null, error: { message: 'MISSING_PAYMENT_DETAILS', code: '22023' } };
      }
      row.funded_by = params.p_user_id;
      row.funded_at = now;
      row.payment_method = pd.method;
      row.payment_bank = pd.bank;
      row.payment_reference = pd.reference;
      row.payment_date = pd.date;
      row.payment_processed_by = params.p_user_id;
    } else if (params.p_to_status === 'Released') {
      if (!isAdmin) {
        return { data: null, error: { message: 'FORBIDDEN_ROLE_NOT_ADMIN', code: '42501' } };
      }
      row.released_by = params.p_user_id;
      row.released_at = now;
    } else if (params.p_to_status === 'Rejected') {
      if (!isAdmin) {
        return { data: null, error: { message: 'FORBIDDEN_ROLE_NOT_ADMIN', code: '42501' } };
      }
      if (!params.p_reason || !String(params.p_reason).trim()) {
        return { data: null, error: { message: 'INVALID_REASON', code: '22023' } };
      }
      row.rejected_by = params.p_user_id;
      row.rejected_at = now;
      row.rejection_reason = String(params.p_reason).trim();
    }

    row.status = params.p_to_status;
    row.updated_at = now;
    row.updated_by = params.p_user_id;
    row.version = (row.version || 1) + 1;

    const histId = nextId();
    mockTables.status_history.set(histId, {
      id: histId,
      table_name: 'disbursements',
      record_id: row.id,
      old_status: oldStatus,
      new_status: row.status,
      actor_id: params.p_user_id,
      entity_id: params.p_entity_id,
      details: {
        action: 'status_change',
        reason: params.p_reason || null,
        payment_details: params.p_payment_details || null,
        previous_version: params.p_expected_version,
      },
      created_at: now,
    });

    return { data: [row], error: null };
  },

  disbursement_atomic_delete: (params) => {
    const row = mockTables.disbursements.get(params.p_id);
    if (!row || row.entity_id !== params.p_entity_id) return { data: [], error: null };
    if (row.deleted_at || row.archived) {
      return { data: null, error: { message: 'ALREADY_DELETED_OR_ARCHIVED', code: 'P0002' } };
    }
    if (row.lifecycle_version !== 2) {
      return { data: null, error: { message: 'SAVED_WORKFLOW_READ_ONLY', code: 'P0002' } };
    }
    if (row.status !== 'Draft') {
      return { data: null, error: { message: 'CANNOT_DELETE_NON_DRAFT', code: 'P0002' } };
    }
    const actor = mockTables.users.get(params.p_user_id);
    const isAdmin = actor?.role === 'Admin';
    const isOwner = row.created_by === params.p_user_id || row.requested_by === params.p_user_id;
    if (!isAdmin && !isOwner) {
      return { data: null, error: { message: 'FORBIDDEN_DELETE_PERMISSION', code: '42501' } };
    }
    if (
      params.p_expected_version === null ||
      params.p_expected_version === undefined ||
      Number(params.p_expected_version) <= 0 ||
      row.version !== Number(params.p_expected_version)
    ) {
      return { data: null, error: { message: 'ERR_CONCURRENCY_CONFLICT', code: 'P0001' } };
    }
    const now = nowIso();
    const oldStatus = row.status;
    row.deleted_at = now;
    row.updated_at = now;
    row.updated_by = params.p_user_id;
    row.version = (row.version || 1) + 1;

    const histId = nextId();
    mockTables.status_history.set(histId, {
      id: histId,
      table_name: 'disbursements',
      record_id: row.id,
      old_status: oldStatus,
      new_status: 'Deleted',
      actor_id: params.p_user_id,
      entity_id: params.p_entity_id,
      details: { action: 'delete', previous_status: oldStatus, previous_version: params.p_expected_version },
      created_at: now,
    });
    return { data: [row], error: null };
  },

  disbursement_archive_toggle: (params) => {
    const row = mockTables.disbursements.get(params.p_id);
    if (!row || row.entity_id !== params.p_entity_id) return { data: [], error: null };
    const actor = mockTables.users.get(params.p_user_id);
    if (actor?.role !== 'Admin') {
      return { data: null, error: { message: 'FORBIDDEN_ROLE_NOT_ADMIN', code: '42501' } };
    }
    if (row.version !== Number(params.p_expected_version)) {
      return { data: null, error: { message: 'ERR_CONCURRENCY_CONFLICT', code: 'P0001' } };
    }
    const now = nowIso();
    row.archived = params.p_archive;
    row.archived_at = params.p_archive ? now : null;
    row.archived_by = params.p_archive ? params.p_user_id : null;
    row.updated_at = now;
    row.updated_by = params.p_user_id;
    row.version = (row.version || 1) + 1;

    const histId = nextId();
    mockTables.status_history.set(histId, {
      id: histId,
      table_name: 'disbursements',
      record_id: row.id,
      old_status: row.status,
      new_status: row.status,
      actor_id: params.p_user_id,
      entity_id: params.p_entity_id,
      details: { action: params.p_archive ? 'archive' : 'unarchive', previous_version: params.p_expected_version },
      created_at: now,
    });
    return { data: [row], error: null };
  },



  disbursement_atomic_edit: (params) => {
    const row = mockTables.disbursements.get(params.p_id);
    if (!row || row.entity_id !== params.p_entity_id) return { data: [], error: null };
    if (row.version !== Number(params.p_expected_version)) {
      return { data: null, error: { message: 'ERR_CONCURRENCY_CONFLICT', code: 'P0001' } };
    }
    const u = params.p_updates || {};
    const actor = mockTables.users.get(params.p_user_id);
    const isAdmin = actor?.role === 'Admin';
    const isFinancial =
      u.amount !== undefined ||
      u.category !== undefined ||
      u.description !== undefined ||
      u.fund_source !== undefined ||
      u.client_id !== undefined ||
      u.linked_work_request_id !== undefined ||
      u.receipt_s3_key !== undefined;

    if (isFinancial && row.status !== 'Draft') {
      return { data: null, error: { message: 'FINANCIAL_EDITS_LOCKED_AFTER_APPROVAL', code: 'P0002' } };
    }
    if (u.print_details !== undefined && !isAdmin) {
      return { data: null, error: { message: 'FORBIDDEN_PRINT_DETAILS_ADMIN_ONLY', code: '42501' } };
    }

    const now = nowIso();
    Object.assign(row, u);
    if (row.review_ready === false && isFinancial) {
      row.review_ready = true;
    }
    row.updated_at = now;
    row.updated_by = params.p_user_id;
    row.version = (row.version || 1) + 1;

    const histId = nextId();
    mockTables.status_history.set(histId, {
      id: histId,
      table_name: 'disbursements',
      record_id: row.id,
      old_status: row.status,
      new_status: row.status,
      actor_id: params.p_user_id,
      entity_id: params.p_entity_id,
      details: { action: 'edit', after: u, previous_version: params.p_expected_version },
      created_at: now,
    });
    return { data: [row], error: null };
  },

  work_request_transition: (params) => {
    const row = mockTables.work_requests.get(params.p_id);
    if (!row) return { data: [], error: null };
    if (row.entity_id !== params.p_entity_id) return { data: [], error: null };
    // post-000046 the DB signature is p_from_statuses text[]; accept arrays.
    const fromStatuses = params.p_from_statuses || (params.p_from_status ? [params.p_from_status] : null);
    if (!fromStatuses || !fromStatuses.includes(row.status)) return { data: [], error: null };

    row.status = params.p_to_status;
    row.updated_at = nowIso();
    row.updated_by = params.p_user_id;
    row.version = (row.version || 1) + 1;
    if (params.p_archived !== undefined && params.p_archived !== null) {
      row.archived = params.p_archived;
    }

    return { data: [row], error: null };
  },

  task_transition: (params) => {
    const row = mockTables.tasks.get(params.p_id);
    if (!row) return { data: [], error: null };
    if (row.work_request_id !== params.p_work_request_id) return { data: [], error: null };
    // post-000046 the DB signature is p_from_statuses text[]; accept arrays.
    const fromStatuses = params.p_from_statuses || (params.p_from_status ? [params.p_from_status] : null);
    if (!fromStatuses || !fromStatuses.includes(row.status)) return { data: [], error: null };

    row.status = params.p_to_status;
    row.updated_at = nowIso();
    row.version = (row.version || 1) + 1;

    return { data: [row], error: null };
  },

  operations_request_fulfill: (params) => {
    const row = mockTables.operations_requests.get(params.p_id);
    if (!row) return { data: [], error: null };
    if (row.entity_id !== params.p_entity_id) return { data: [], error: null };
    if (row.status !== 'pending') return { data: [], error: null };

    const now = nowIso();
    row.status = 'fulfilled';
    row.fulfilled_by = params.p_fulfilled_by;
    row.fulfilled_at = now;
    row.updated_at = now;
    row.version = (row.version || 1) + 1;

    return { data: [row], error: null };
  },

  operations_request_reject: (params) => {
    const row = mockTables.operations_requests.get(params.p_id);
    if (!row) return { data: [], error: null };
    if (row.entity_id !== params.p_entity_id) return { data: [], error: null };
    if (row.status !== 'pending') return { data: [], error: null };

    row.status = 'rejected';
    row.rejection_reason = params.p_rejection_reason || null;
    row.updated_at = nowIso();
    row.version = (row.version || 1) + 1;

    return { data: [row], error: null };
  },

  pending_change_approve: (params) => {
    const row = mockTables.pending_changes.get(params.p_id);
    if (!row) return { data: [], error: null };
    if (row.entity_id !== params.p_entity_id) return { data: [], error: null };
    if (row.status !== 'pending') return { data: [], error: null };

    const now = nowIso();
    row.status = 'approved';
    row.reviewed_by = params.p_user_id;
    row.reviewed_at = now;
    row.version = (row.version || 1) + 1;

    return { data: [row], error: null };
  },

  invoice_record_payment: (params) => {
    const invoice = mockTables.invoices.get(params.p_invoice_id);
    if (!invoice) {
      return { data: null, error: { message: 'Invoice not found', code: 'P0002' } };
    }
    if (invoice.entity_id !== params.p_entity_id) {
      return { data: null, error: { message: 'Invoice not found', code: 'P0002' } };
    }
    if (invoice.deleted_at) {
      return { data: null, error: { message: 'Invoice not found', code: 'P0002' } };
    }

    const payment = {
      id: nextId(),
      invoice_id: params.p_invoice_id,
      amount: Number(params.p_amount),
      method: params.p_method || null,
      reference: params.p_reference || null,
      payment_date: params.p_payment_date,
      recorded_by: params.p_recorded_by,
      notes: params.p_notes || null,
      created_at: nowIso(),
    };
    mockTables.invoice_payments.set(payment.id, payment);

    const totalPaid = Array.from(mockTables.invoice_payments.values())
      .filter((p) => p.invoice_id === params.p_invoice_id)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const balance = Number(invoice.total) - totalPaid;

    if (balance < 0) {
      mockTables.invoice_payments.delete(payment.id);
      return {
        data: null,
        error: { message: 'Overpayment: payment would exceed invoice balance', code: 'P0001' },
      };
    }

    const status = balance === 0 ? 'Paid' : 'Partially Paid';
    invoice.amount_paid = totalPaid;
    invoice.balance = balance;
    invoice.status = status;
    invoice.updated_at = nowIso();
    invoice.updated_by = params.p_recorded_by;
    invoice.version = (invoice.version || 1) + 1;

    return { data: { payment, invoice }, error: null };
  },

  // Atomic document sequence allocator (migration 000047). A shared per-prefix
  // counter serializes allocation exactly like the row-locking upsert does in
  // PostgreSQL, so concurrent creates always receive distinct numbers.
  next_document_sequence: (params) => {
    const prefix = params.p_prefix;
    const row = mockTables.document_sequences.get(prefix) || {
      prefix,
      current_val: 0,
    };
    row.current_val += 1;
    row.updated_at = nowIso();
    mockTables.document_sequences.set(prefix, row);
    return { data: `${prefix}-${String(row.current_val).padStart(4, '0')}`, error: null };
  },

  // Atomic invoice create (migration 000047): invoice row + line items in one
  // step, mirroring invoice_create_transactional().
  invoice_create_transactional: (params) => {
    const d = params.p_invoice_data || {};
    const invoice = {
      id: d.id || nextId(),
      entity_id: params.p_entity_id,
      client_id: d.clientId || null,
      work_request_id: d.workRequestId || null,
      linked_task_id: d.linkedTaskId || null,
      task_id: d.taskId || d.task_id || d.linkedTaskId || null,
      linked_transmittal_id: d.linkedTransmittalId || null,
      invoice_number: d.invoiceNumber,
      issue_date: d.issueDate,
      due_date: d.dueDate,
      status: d.status || 'Draft',
      subtotal: d.subtotal ?? 0,
      tax_amount: 0,
      total: d.total ?? 0,
      amount_paid: 0,
      balance: d.total ?? 0,
      notes: d.notes ?? null,
      terms: d.terms ?? null,
      archived: false,
      created_by: params.p_user_id,
      updated_by: params.p_user_id,
      created_at: nowIso(),
      updated_at: nowIso(),
      version: 1,
    };

    const dup = Array.from(mockTables.invoices.values()).find(
      (r) => r.entity_id === invoice.entity_id && r.invoice_number === invoice.invoice_number
    );
    if (dup) {
      return {
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "invoices_entity_id_invoice_number_key"',
          code: '23505',
        },
      };
    }

    mockTables.invoices.set(invoice.id, invoice);

    (params.p_line_items || []).forEach((item, idx) => {
      const li = {
        id: nextId(),
        invoice_id: invoice.id,
        description: item.description,
        amount: Number(item.amount),
        type: item.type || 'Professional Fee',
        sort_order: item.sort_order ?? idx,
        created_at: nowIso(),
      };
      mockTables.invoice_line_items.set(li.id, li);
    });

    return { data: invoice, error: null };
  },

  // Atomic invoice update (migration 000047): line-item replacement, totals,
  // version bump, and OCC guard in one step, mirroring
  // invoice_update_transactional(). Returns null data when the version guard
  // rejects a stale write (the service maps that to 409).
  invoice_update_transactional: (params) => {
    const invoice = mockTables.invoices.get(params.p_invoice_id);
    if (!invoice || invoice.entity_id !== params.p_entity_id) return { data: null, error: null };
    if (
      params.p_expected_version !== null &&
      params.p_expected_version !== undefined &&
      invoice.version !== Number(params.p_expected_version)
    ) {
      return {
        data: null,
        error: {
          message: `ERR_CONCURRENCY_CONFLICT: Invoice version mismatch (expected ${params.p_expected_version}, found ${invoice.version})`,
          code: 'P0001',
        },
      };
    }

    const u = params.p_updates || {};
    const isFinancial =
      (params.p_line_items !== null && params.p_line_items !== undefined) ||
      u.client_id !== undefined ||
      u.work_request_id !== undefined ||
      u.task_id !== undefined ||
      u.linked_task_id !== undefined ||
      u.taskId !== undefined ||
      u.linkedTaskId !== undefined ||
      u.linked_transmittal_id !== undefined ||
      u.invoice_number !== undefined ||
      u.issue_date !== undefined ||
      u.due_date !== undefined ||
      u.terms !== undefined;

    const isAdmin = mockTables.users.get(params.p_user_id)?.role === 'Admin';
    if (u.print_details !== undefined && !isAdmin) {
      return { data: null, error: { message: 'Only administrators can edit statement details', code: '42501' } };
    }
    if (isFinancial && invoice.status !== 'Draft' && !isAdmin) {
      return {
        data: null,
        error: {
          message: `INVOICE_NOT_DRAFT: Cannot modify financial fields or line items of non-draft invoice (current status ${invoice.status})`,
          code: 'P0002',
        },
      };
    }

    let subtotal = null;
    if (params.p_line_items !== null && params.p_line_items !== undefined) {
      const proposed = params.p_line_items.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100;
      if (proposed < Number(invoice.amount_paid || 0)) {
        return { data: null, error: { message: 'INVOICE_TOTAL_BELOW_PAID', code: '22023' } };
      }
      Array.from(mockTables.invoice_line_items.values())
        .filter((li) => li.invoice_id === params.p_invoice_id)
        .forEach((li) => mockTables.invoice_line_items.delete(li.id));

      params.p_line_items.forEach((item, idx) => {
        const li = {
          id: nextId(),
          invoice_id: params.p_invoice_id,
          description: item.description,
          amount: Number(item.amount),
          type: item.type || 'Professional Fee',
          sort_order: item.sort_order ?? idx,
          created_at: nowIso(),
        };
        mockTables.invoice_line_items.set(li.id, li);
      });

      subtotal = params.p_line_items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    }

    Object.keys(u).forEach((key) => {
      invoice[key] = u[key];
    });
    if (subtotal !== null) {
      invoice.subtotal = subtotal;
      invoice.total = subtotal;
      invoice.balance = subtotal - Number(invoice.amount_paid || 0);
      if (u.status === undefined && Number(invoice.amount_paid) > 0 && ['Paid', 'Partially Paid', 'Sent', 'Approved', 'Overdue'].includes(invoice.status)) {
        invoice.status = invoice.balance === 0 ? 'Paid' : 'Partially Paid';
      }
    }
    invoice.updated_by = params.p_user_id;
    invoice.updated_at = nowIso();
    invoice.version = (invoice.version || 1) + 1;

    return { data: invoice, error: null };
  },

  client_archive_cascade: (params) => {
    const client = mockTables.clients.get(params.p_id);
    if (!client) return { data: [], error: null };
    if (client.entity_id !== params.p_entity_id) return { data: [], error: null };

    const now = nowIso();
    const unarchive = params.p_unarchive === true;
    client.status = unarchive ? 'Active' : 'Archived';
    client.deleted_at = unarchive ? null : now;
    client.archived_at = unarchive ? null : now;
    client.archived_by = unarchive ? null : params.p_user_id;
    client.updated_by = params.p_user_id;
    client.updated_at = now;
    client.version = (client.version || 1) + 1;

    const wrs = Array.from(mockTables.work_requests.values()).filter(
      (wr) => wr.client_id === params.p_id && wr.entity_id === params.p_entity_id
    );
    wrs.forEach((wr) => {
      if (!unarchive) {
        wr.status = 'Cancelled';
        wr.updated_at = now;
        wr.updated_by = params.p_user_id;
        wr.version = (wr.version || 1) + 1;
      }

      const docs = Array.from(mockTables.documents.values()).filter(
        (doc) => doc.work_request_id === wr.id && doc.entity_id === params.p_entity_id
      );
      docs.forEach((doc) => {
        doc.status = unarchive ? doc.status : 'Archived';
        doc.archived = !unarchive;
        doc.archived_at = unarchive ? doc.archived_at : now;
        doc.archived_by = unarchive ? doc.archived_by : params.p_user_id;
        doc.updated_at = now;
        doc.version = (doc.version || 1) + 1;
      });
    });

    return { data: [client], error: null };
  },
};

const supabaseAdmin = {
  auth: {
    getUser: (token) => {
      const user = mockUsers.get(token);
      if (!user)
        return Promise.resolve({ data: { user: null }, error: { message: 'Invalid token' } });
      return Promise.resolve({
        data: { user: { id: user.auth_user_id, email: user.email } },
        error: null,
      });
    },
    signInWithPassword: (credentials) => {
      for (const record of mockUsers.values()) {
        if (
          record.email === credentials?.email &&
          (record.password === credentials?.password || (!record.password && credentials?.password === 'oldpass'))
        ) {
          return Promise.resolve({
            data: {
              user: { id: record.auth_user_id, email: record.email },
              session: {
                access_token: `token-${record.email}`,
                refresh_token: 'mock-refresh-token',
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              },
            },
            error: null,
          });
        }
      }
      return Promise.resolve({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', status: 400 },
      });
    },
    admin: {
      createUser: ({ email, password }) => {
        const authUserId = nextId();
        const record = {
          id: authUserId,
          email,
          password,
          email_confirmed_at: new Date().toISOString(),
        };
        return Promise.resolve({ data: { user: record }, error: null });
      },
      updateUserById: (authUserId, updates) => {
        const record = { id: authUserId, ...updates };
        for (const user of mockUsers.values()) {
          if (user.auth_user_id === authUserId) {
            if (updates.password) user.password = updates.password;
          }
        }
        return Promise.resolve({ data: { user: record }, error: null });
      },
    },
  },
  from: (tableName) => tableQuery(tableName),
  rpc: (functionName, params = {}) => {
    const impl = rpcImpl[functionName];
    if (!impl) {
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve(impl(params));
  },
  storage: {
    listBuckets: () => Promise.resolve({ data: [{ name: 'test-bucket' }], error: null }),
    createBucket: () => Promise.resolve({ data: { name: 'avatars' }, error: null }),
    updateBucket: () => Promise.resolve({ data: { name: 'avatars' }, error: null }),
    from: (_bucketName) => ({
      createSignedUploadUrl: (_path) =>
        Promise.resolve({
          data: {
            signedUrl: 'https://storage.example.com/upload',
          },
          error: null,
        }),
      createSignedUrl: (_path, _expiresIn) =>
        Promise.resolve({
          data: {
            signedUrl: 'https://storage.example.com/download',
          },
          error: null,
        }),
      remove: (paths) => {
        (paths || []).forEach((p) => mockStorageObjects.delete(p));
        return Promise.resolve({ data: null, error: null });
      },
      upload: (path, buffer, options) => {
        mockStorageObjects.set(path, {
          buffer: buffer || Buffer.from('mock-bytes'),
          size: buffer ? buffer.length : 1024,
          contentType: options?.contentType || 'application/octet-stream',
        });
        return Promise.resolve({ data: { path }, error: null });
      },
      list: (folder, _options) => {
        const prefix = folder ? (folder.endsWith('/') ? folder : folder + '/') : '';
        const items = Array.from(mockStorageObjects.keys())
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({
            name: k.slice(prefix.length),
            metadata: { size: mockStorageObjects.get(k)?.size || 1024 },
          }));
        return Promise.resolve({ data: items, error: null });
      },
      download: (path) => {
        if (!mockStorageObjects.has(path)) {
          return Promise.resolve({ data: null, error: { message: 'Object not found' } });
        }
        const obj = mockStorageObjects.get(path);
        let buffer = obj.buffer || Buffer.from('mock-bytes');
        if (!Buffer.isBuffer(buffer)) {
          buffer = Buffer.from(buffer);
        }
        buffer.contentType = obj.contentType;
        buffer.type = obj.contentType;
        buffer.size = obj.size !== undefined ? obj.size : buffer.length;
        return Promise.resolve({ data: buffer, error: null });
      },
    }),
  },
};

const resetMock = () => {
  mockUsers.clear();
  mockTokens.clear();
  mockStorageObjects.clear();
  Object.keys(mockTables).forEach((key) => mockTables[key].clear());
  sequence = 0;
  try {
    const { clearProfileCache } = require('../../src/middleware/auth');
    clearProfileCache();
  } catch (e) {
    // Ignore if not available
  }
};

module.exports = {
  supabaseAdmin,
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  mockStorageObjects,
};
