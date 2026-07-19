/**
 * Mock Supabase admin client for integration tests.
 * Allows tests to register fake users and audit expectations.
 */

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
  ground_workers: new Map(),
};

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `mock-${sequence}`;
};

/**
 * Seed the entities and departments required by most tests.
 */
const seedDefaults = () => {
  mockTables.entities.set('ent-ata', { id: 'ent-ata', code: 'ATA', name: 'ATA Accounting Firm' });
  mockTables.entities.set('ent-lta', { id: 'ent-lta', code: 'LTA', name: 'LTA Accounting Firm' });

  const depts = ['Accounting', 'Operations', 'Documentation', 'HR', 'Management', 'Legal', 'Tax', 'Audit', 'Business Development'];
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
    name: user.name,
    role: user.role,
    entities: user.entities || ['ATA'],
    is_active: user.isActive !== false,
    avatar_url: user.avatarUrl || null,
    preferences: user.preferences || {},
    password_updated_at: user.passwordUpdatedAt || null,
  };
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
  let order = null;
  let limit = null;
  let op = 'select';
  let countOptions = null;
  let insertRecords = null;
  let updateValues = null;

  const matchFilter = (row, { column, value, op: fop = 'eq' }) => {
    const rowValue = row[column];
    if (fop === 'is') {
      return value === null ? (rowValue === null || rowValue === undefined) : rowValue === value;
    }
    if (fop === 'in') {
      return Array.isArray(value) && value.includes(rowValue);
    }
    if (fop === 'gt') {
      return rowValue !== null && rowValue !== undefined && Number(rowValue) > Number(value);
    }
    if (fop === 'gte') {
      return rowValue !== null && rowValue !== undefined && Number(rowValue) >= Number(value);
    }
    if (fop === 'lte') {
      return rowValue !== null && rowValue !== undefined && Number(rowValue) <= Number(value);
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
    // Expected: column.ilike.%value% or column.eq.value
    const m = part.match(/^([^.]+)\.([^.]+)\.%?(.+)%?$/);
    if (!m) return null;
    return { column: m[1], value: m[3], op: m[2] };
  };

  const applyFilters = () => {
    return Array.from(rows.values()).filter((row) =>
      filters.every((filter) => {
        if (filter.op === 'or') {
          return filter.parts.some((part) => {
            const parsed = parseOrPart(part);
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
      const inserted = [];
      insertRecords.forEach((rec) => {
        const id = rec.id || nextId();
        const stored = { ...rec, id };
        rows.set(id, stored);
        inserted.push(stored);
      });
      return inserted;
    }

    if (order) {
      result.sort((a, b) => {
        const aVal = a[order.column];
        const bVal = b[order.column];
        if (aVal === null || aVal === undefined || bVal === null || bVal === undefined) return 0;
        if (aVal < bVal) return order.ascending ? -1 : 1;
        if (aVal > bVal) return order.ascending ? 1 : -1;
        return 0;
      });
    }

    if (limit) result = result.slice(0, limit);
    if (builder._postFilters) {
      builder._postFilters.forEach((fn) => { result = fn(result); });
    }
    return result;
  };

  const builder = {
    select: (_columns, options = {}) => {
      if (options.count) {
        countOptions = options;
      }
      return builder;
    },
    eq: (column, value) => {
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
      order = { column, ascending };
      return builder;
    },
    limit: (n) => {
      limit = n;
      return builder;
    },
    range: (from, to) => {
      // Store as a filter that slices after ordering; we apply in execute via postFilters
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
    ilike: (column, value) => {
      filters.push({ column, value, op: 'ilike' });
      return builder;
    },
    or: (expression) => {
      // Very coarse OR parser for patterns like col.ilike.%term%,col2.ilike.%term%
      const parts = expression.split(',');
      filters.push({ op: 'or', parts });
      return builder;
    },
    insert: (records) => {
      op = 'insert';
      insertRecords = Array.isArray(records) ? records : [records];
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
      const result = execute();
      return Promise.resolve({ data: result[0] || null, error: null });
    },
    single: () => {
      const result = execute();
      if (result.length === 0) {
        return Promise.resolve({ data: null, error: { message: 'No rows found' } });
      }
      return Promise.resolve({ data: result[0], error: null });
    },
    count: (options = {}) => {
      const result = execute();
      const count = result.length;
      if (options.head) {
        return Promise.resolve({ data: null, count, error: null });
      }
      return Promise.resolve({ data: [{ count }], count, error: null });
    },
    then: (resolve) => {
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

const supabaseAdmin = {
  auth: {
    getUser: (token) => {
      const user = mockUsers.get(token);
      if (!user) return Promise.resolve({ data: { user: null }, error: { message: 'Invalid token' } });
      return Promise.resolve({
        data: { user: { id: user.auth_user_id, email: user.email } },
        error: null,
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
        return Promise.resolve({ data: { user: record }, error: null });
      },
    },
  },
  from: (tableName) => tableQuery(tableName),
  rpc: () => Promise.resolve({ data: null, error: null }),
  storage: {
    listBuckets: () => Promise.resolve({ data: [{ name: 'test-bucket' }], error: null }),
    from: () => ({
      createSignedUploadUrl: () => Promise.resolve({ data: { signedUrl: 'https://storage.example.com/upload' }, error: null }),
      createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://storage.example.com/download' }, error: null }),
      remove: () => Promise.resolve({ data: null, error: null }),
      upload: () => Promise.resolve({ data: { path: 'test-path' }, error: null }),
    }),
  },
};

const resetMock = () => {
  mockUsers.clear();
  mockTokens.clear();
  Object.keys(mockTables).forEach((key) => mockTables[key].clear());
  sequence = 0;
  // Clear the auth middleware's in-memory profile cache so stale cached
  // profiles from a previous test don't leak into the next test.
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
};
