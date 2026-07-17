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
  let insertRecords = null;
  let updateValues = null;

  const applyFilters = () => {
    return Array.from(rows.values()).filter((row) =>
      filters.every(({ column, value, op: fop = 'eq' }) => {
        const rowValue = row[column];
        if (fop === 'is') {
          return value === null ? (rowValue === null || rowValue === undefined) : rowValue === value;
        }
        if (fop === 'in') {
          return Array.isArray(value) && value.includes(rowValue);
        }
        if (Array.isArray(rowValue)) return rowValue.includes(value);
        return rowValue === value;
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
    return result;
  };

  const builder = {
    select: () => {
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
    then: (resolve) => {
      const result = execute();
      return Promise.resolve({ data: result, error: null }).then(resolve);
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
    },
  },
  from: (tableName) => tableQuery(tableName),
  rpc: () => Promise.resolve({ data: null, error: null }),
};

const resetMock = () => {
  mockUsers.clear();
  mockTokens.clear();
  Object.keys(mockTables).forEach((key) => mockTables[key].clear());
  sequence = 0;
};

module.exports = {
  supabaseAdmin,
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
};
