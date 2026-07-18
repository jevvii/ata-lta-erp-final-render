/**
 * API client for the ATA & LTA ERP backend.
 * Replaces direct localStorage access for business data.
 *
 * This file is owned by Agent A / Team A (Phase 1).
 * Other modules should use the exported helpers rather than calling fetch directly.
 */

(function () {
  'use strict';

  // Injected at build time or read from a global config.
  const API_BASE_URL = window.__ERP_API_BASE_URL__ || 'http://localhost:3000/v1';

  /**
   * Read the active JWT from sessionStorage.
   * @returns {string|null}
   */
  const getToken = () => {
    try {
      return sessionStorage.getItem('erp_access_token');
    } catch (e) {
      return null;
    }
  };

  /**
   * Read the active entity from the global Auth state.
   * @returns {string|null}
   */
  const getActiveEntity = () => {
    return (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
  };

  /**
   * Core request helper.
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  const request = async (path, options = {}) => {
    const url = `${API_BASE_URL}${path}`;
    const token = getToken();
    const entity = getActiveEntity();

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (entity) {
      headers['X-Active-Entity'] = entity;
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      // Clear stale session and redirect to login.
      try {
        sessionStorage.removeItem('erp_access_token');
      } catch (e) {
        // ignore
      }
      window.location.hash = '';
      throw new Error('Session expired. Please sign in again.');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }

    if (res.status === 204) {
      return null;
    }

    return res.json();
  };

  /**
   * Generic CRUD helpers.
   */
  const get = (path) => request(path, { method: 'GET' });
  const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
  const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) });
  const patch = (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) });
  const del = (path) => request(path, { method: 'DELETE' });

  // Resource-specific API helpers (stubs for now)
  window.apiClient = {
    get,
    post,
    put,
    patch,
    delete: del,

    auth: {
      signin: (credentials) => post('/auth/signin', credentials),
    },

    me: {
      get: () => get('/me'),
      permissions: () => get('/me/permissions'),
      team: () => get('/me/team'),
      update: (body) => patch('/me', body),
      changePassword: (body) => patch('/me/password', body),
      avatarUploadUrl: () => post('/me/avatar-upload-url'),
    },

    userCache: {
      _users: null,
      _promise: null,
      async ensure() {
        if (this._users) return this._users;
        if (this._promise) return this._promise;
        this._promise = window.apiClient.me.team().then(res => {
          this._users = res.data || [];
          return this._users;
        }).catch(err => {
          this._users = [];
          return this._users;
        }).finally(() => {
          this._promise = null;
        });
        return this._promise;
      },
      getById(id) {
        if (!id || !this._users) return null;
        return this._users.find(u => u.id === id) || null;
      },
      getByName(name) {
        if (!name || !this._users) return null;
        return this._users.find(u => u.name === name) || null;
      },
      invalidate() {
        this._users = null;
      }
    },

    clientCache: {
      _clients: null,
      _promise: null,
      async ensure() {
        if (this._clients) return this._clients;
        if (this._promise) return this._promise;
        this._promise = window.apiClient.clients.list({}).then(res => {
          this._clients = (res.data || []).map(c => this._normalize(c));
          return this._clients;
        }).catch(err => {
          this._clients = [];
          return this._clients;
        }).finally(() => {
          this._promise = null;
        });
        return this._promise;
      },
      _normalize(client) {
        if (!client) return client;
        return {
          ...client,
          relatedCompanies: (client.relatedCompanies || []).map(rc => ({
            clientId: rc.relatedClientId || rc.clientId,
            relationType: rc.relationship || rc.relationType,
            relationship: rc.relationship || rc.relationType,
            id: rc.id
          }))
        };
      },
      getById(id) {
        if (!id || !this._clients) return null;
        return this._clients.find(c => c.id === id) || null;
      },
      getByName(name) {
        if (!name || !this._clients) return null;
        return this._clients.find(c => c.name === name) || null;
      },
      invalidate() {
        this._clients = null;
      }
    },

    workRequestCache: {
      _wrs: null,
      _promise: null,
      async ensure() {
        if (this._wrs) return this._wrs;
        if (this._promise) return this._promise;
        this._promise = window.apiClient.workRequests.list({}).then(res => {
          this._wrs = res.data || [];
          return this._wrs;
        }).catch(err => {
          this._wrs = [];
          return this._wrs;
        }).finally(() => {
          this._promise = null;
        });
        return this._promise;
      },
      getById(id) {
        if (!id || !this._wrs) return null;
        return this._wrs.find(wr => wr.id === id) || null;
      },
      getByTitle(title) {
        if (!title || !this._wrs) return null;
        return this._wrs.find(wr => wr.title === title) || null;
      },
      invalidate() {
        this._wrs = null;
      }
    },

    clients: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/clients${q ? '?' + q : ''}`);
      },
      create: (data) => post('/clients', data),
      get: (id) => get(`/clients/${id}`),
      update: (id, data) => put(`/clients/${id}`, data),
      remove: (id) => del(`/clients/${id}`),
    },

    documents: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/documents${q ? '?' + q : ''}`);
      },
      create: (data) => post('/documents', data),
      get: (id) => get(`/documents/${id}`),
      update: (id, data) => put(`/documents/${id}`, data),
      remove: (id) => del(`/documents/${id}`),
      confirmUpload: (id) => post(`/documents/${id}/confirm-upload`),
      downloadUrl: (id) => get(`/documents/${id}/download-url`),
      updateLifecycle: (id, data) => put(`/documents/${id}/lifecycle`, data),
    },

    workRequests: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/work-requests${q ? '?' + q : ''}`);
      },
      create: (data) => post('/work-requests', data),
      get: (id) => get(`/work-requests/${id}`),
      update: (id, data) => put(`/work-requests/${id}`, data),
      remove: (id) => del(`/work-requests/${id}`),
      listTasks: (wrId) => get(`/work-requests/${wrId}/tasks`),
      createTask: (wrId, data) => post(`/work-requests/${wrId}/tasks`, data),
      updateTask: (wrId, taskId, data) => put(`/work-requests/${wrId}/tasks/${taskId}`, data),
      removeTask: (wrId, taskId) => del(`/work-requests/${wrId}/tasks/${taskId}`),
    },

    invoices: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/invoices${q ? '?' + q : ''}`);
      },
      create: (data) => post('/invoices', data),
      get: (id) => get(`/invoices/${id}`),
      update: (id, data) => put(`/invoices/${id}`, data),
      remove: (id) => del(`/invoices/${id}`),
      recordPayment: (id, data) => post(`/invoices/${id}/payments`, data),
      pdf: (id) => get(`/invoices/${id}/pdf`),
      voucher: (id) => get(`/invoices/${id}/voucher`),
      listTemplates: () => get('/invoices/templates'),
      createTemplate: (data) => post('/invoices/templates', data),
      updateTemplate: (id, data) => put(`/invoices/templates/${id}`, data),
      deleteTemplate: (id) => del(`/invoices/templates/${id}`),
    },

    disbursements: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/disbursements${q ? '?' + q : ''}`);
      },
      create: (data) => post('/disbursements', data),
      get: (id) => get(`/disbursements/${id}`),
      update: (id, data) => put(`/disbursements/${id}`, data),
      submit: (id) => post(`/disbursements/${id}/submit`),
      approve: (id) => post(`/disbursements/${id}/approve`),
      release: (id) => post(`/disbursements/${id}/release`),
      reject: (id, data) => post(`/disbursements/${id}/reject`, data),
    },

    transmittals: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/transmittals${q ? '?' + q : ''}`);
      },
      create: (data) => post('/transmittals', data),
      get: (id) => get(`/transmittals/${id}`),
      update: (id, data) => put(`/transmittals/${id}`, data),
      send: (id) => post(`/transmittals/${id}/send`),
      acknowledge: (id) => post(`/transmittals/${id}/acknowledge`),
    },

    reports: {
      analytics: () => get('/reports/analytics'),
      daily: (date) => get(`/reports/daily?date=${encodeURIComponent(date)}`),
      weekly: (date) => get(`/reports/weekly?date=${encodeURIComponent(date)}`),
      monthlyPending: (month) => get(`/reports/monthly-pending?month=${encodeURIComponent(month)}`),
      aging: () => get('/reports/aging'),
    },

    admin: {
      listUsers: () => get('/admin/users'),
      createUser: (data) => post('/admin/users', data),
      getUser: (id) => get(`/admin/users/${id}`),
      updateUser: (id, data) => put(`/admin/users/${id}`, data),
      deleteUser: (id) => del(`/admin/users/${id}`),
      listPendingApprovals: () => get('/admin/pending-approvals'),
      approvePending: (id) => post(`/admin/pending-approvals/${id}/approve`),
      rejectPending: (id, data) => post(`/admin/pending-approvals/${id}/reject`, data),
    },
  };
})();
