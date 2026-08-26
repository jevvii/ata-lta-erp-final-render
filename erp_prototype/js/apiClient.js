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

  // In-flight GET request registry used for lightweight request deduplication.
  const inFlight = new Map();

  /**
   * Read the active JWT from localStorage.
   * @returns {string|null}
   */
  const getToken = () => {
    try {
      return localStorage.getItem('erp_access_token');
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
   * Check whether a record's entity matches the active entity.
   * Mirrors the shared matchesEntity() helper in utils.js.
   * @param {string|null} recordEntity
   * @param {string|null} activeEntity
   * @returns {boolean}
   */
  const entityMatches = (recordEntity, activeEntity) => {
    const itemEnt = (recordEntity || '').toUpperCase();
    if (!itemEnt) return true;
    const active = (activeEntity || '').toUpperCase();
    if (!active || active === 'ALL') {
      const userEnts = (Auth.user?.entities || []).map(e => e.toUpperCase());
      return userEnts.length > 0 ? userEnts.includes(itemEnt) : true;
    }
    return itemEnt === active;
  };

  /**
   * Combine two AbortSignals so that the resulting signal aborts when either
   * source aborts. Falls back to manual listeners if AbortSignal.any is unavailable.
   * @param {AbortSignal} callerSignal
   * @param {AbortSignal} internalSignal
   * @returns {AbortSignal}
   */
  function combineSignals(callerSignal, internalSignal) {
    if (!callerSignal) return internalSignal;
    if (!internalSignal) return callerSignal;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
      return AbortSignal.any([callerSignal, internalSignal]);
    }
    const combined = new AbortController();
    const onAbort = () => combined.abort(callerSignal.aborted ? callerSignal.reason : internalSignal.reason);
    callerSignal.addEventListener('abort', onAbort);
    internalSignal.addEventListener('abort', onAbort);
    return combined.signal;
  }

  /**
   * Core request helper.
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  const request = async (path, options = {}) => {
    const url = `${API_BASE_URL}${path}`;
    const token = getToken();
    
    let activeEntityHeader = getActiveEntity();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method || 'GET')) {
      let payloadEntity = null;
      if (options.headers && options.headers['X-Active-Entity']) {
        payloadEntity = options.headers['X-Active-Entity'];
      }
      if (!payloadEntity && options.body) {
        try {
          const parsed = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          if (parsed) {
            payloadEntity = parsed.entity || parsed.entity_code || parsed.entityId;
            if (!payloadEntity) {
              const wrId = parsed.workRequestId || parsed.work_request_id || parsed.linkedWorkRequestId || parsed.linked_work_request_id;
              if (wrId && window.apiClient && window.apiClient.workRequestCache && typeof window.apiClient.workRequestCache.getById === 'function') {
                const wr = window.apiClient.workRequestCache.getById(wrId);
                if (wr && wr.entity) {
                  payloadEntity = wr.entity;
                }
              }
              if (!payloadEntity && wrId && typeof WorkflowData !== 'undefined' && typeof WorkflowData.getWorkRequestById === 'function') {
                const wr = WorkflowData.getWorkRequestById(wrId);
                if (wr && wr.entity) {
                  payloadEntity = wr.entity;
                }
              }
            }
          }
        } catch (e) {}
      }
      if (payloadEntity && payloadEntity !== 'ALL') {
        activeEntityHeader = payloadEntity;
      }
    }

    const { __controller, signal: callerSignal, ...restOptions } = options;

    const headers = {
      'Content-Type': 'application/json',
      ...restOptions.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (activeEntityHeader && !headers['X-Active-Entity']) {
      headers['X-Active-Entity'] = activeEntityHeader;
    }

    let signal;
    if (__controller) {
      signal = combineSignals(callerSignal, __controller.signal);
    } else if (callerSignal) {
      signal = callerSignal;
    }

    if (signal && signal.aborted) {
      const abortError = new Error(signal.reason || 'Request aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const res = await fetch(url, {
      ...restOptions,
      headers,
      signal,
    });

    if (res.status === 401 && !path.startsWith('/auth/')) {
      const rToken = localStorage.getItem('erp_refresh_token');
      if (rToken) {
        try {
          const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: rToken }),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            const { accessToken, refreshToken: newRefreshToken } = refreshData.data;
            localStorage.setItem('erp_access_token', accessToken);
            if (newRefreshToken) {
              localStorage.setItem('erp_refresh_token', newRefreshToken);
            }
            headers.Authorization = `Bearer ${accessToken}`;
            const retryRes = await fetch(url, {
              ...restOptions,
              headers,
              signal,
            });
            if (retryRes.status !== 401) {
              if (retryRes.status === 204) {
                return null;
              }
              return retryRes.json();
            }
          }
        } catch (refreshErr) {
          console.error('[apiClient] Automatic token refresh failed:', refreshErr);
        }
      }

      // Clear stale session and redirect to login.
      try {
        localStorage.removeItem('erp_access_token');
        localStorage.removeItem('erp_refresh_token');
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

    // Invalidate service worker API caches on successful mutations
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method || 'GET')) {
      if (typeof caches !== 'undefined' && caches.keys) {
        caches.keys().then(keys => {
          keys.forEach(key => {
            if (key.startsWith('erp-api-')) {
              caches.delete(key).catch(() => {});
            }
          });
        }).catch(() => {});
      }
    }

    if (res.status === 204) {
      return null;
    }

    return res.json();
  };

  /**
   * Generic CRUD helpers.
   */
  const get = (path, options = {}) => {
    const url = `${API_BASE_URL}${path}`;
    const entity = getActiveEntity();
    const key = `GET ${url} ${entity || ''}`;

    // If the caller supplied their own signal, do not deduplicate; start fresh.
    if (!options.signal && inFlight.has(key)) {
      return inFlight.get(key).promise;
    }

    const controller = new AbortController();
    const promise = request(path, { ...options, method: 'GET', __controller: controller })
      .finally(() => {
        const entry = inFlight.get(key);
        if (entry && entry.controller === controller) {
          inFlight.delete(key);
        }
      });

    inFlight.set(key, { promise, controller });
    return promise;
  };

  const post = (path, body, options = {}) => request(path, { ...options, method: 'POST', body: JSON.stringify(body) });
  const put = (path, body, options = {}) =>
    request(path, { ...options, method: 'PUT', body: JSON.stringify(body) });
  const patch = (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body: JSON.stringify(body) });
  const del = (path, options = {}) => request(path, { ...options, method: 'DELETE' });

  // Lightweight 30-second cache for tab-badge count endpoints.
  const countCache = new Map();
  const COUNT_TTL_MS = 30 * 1000;

  const isAbortError = (err) => {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    if (err.message === 'route-change' || err.reason === 'route-change') return true;
    const str = String(err.message || err.reason || err || '').toLowerCase();
    return str.includes('aborted') || str.includes('route-change') || str.includes('cancel');
  };

  const cachedCount = (cacheKey, fetcher, fallback) => {
    const now = Date.now();
    const cached = countCache.get(cacheKey);
    if (cached && now - cached.ts < COUNT_TTL_MS) return Promise.resolve(cached.value);
    return fetcher().then((value) => {
      countCache.set(cacheKey, { ts: Date.now(), value });
      return value;
    }).catch((err) => {
      // Route-change aborts are expected; do not spam the console with them.
      if (!isAbortError(err)) {
        console.error(`[apiClient] count fetch failed for ${cacheKey}`, err);
      }
      return fallback;
    });
  };

  const invalidateCountCache = (prefix) => {
    for (const key of countCache.keys()) {
      if (key.startsWith(prefix)) countCache.delete(key);
    }
  };

  const countUrl = (path, entityId) => {
    const entity = entityId || getActiveEntity() || '';
    return `${path}?entityId=${encodeURIComponent(entity)}`;
  };

  const extractWrId = (obj) => {
    if (!obj) return null;
    return obj.workRequestId || obj.work_request_id || obj.linkedWorkRequestId || obj.linked_work_request_id;
  };

  const invalidateWrRelated = (wrId) => {
    if (wrId && typeof WorkflowData !== 'undefined' && typeof WorkflowData.invalidateRelatedForWorkRequest === 'function') {
      WorkflowData.invalidateRelatedForWorkRequest(wrId);
    }
  };

  const handleMutationInvalidation = (res, inputData, type, id) => {
    try {
      let wrId = extractWrId(res?.data);
      if (!wrId) {
        wrId = extractWrId(inputData);
      }
      if (!wrId && id) {
        if (type === 'invoice' && typeof Billing !== 'undefined' && typeof Billing.getInvoiceById === 'function') {
          const inv = Billing.getInvoiceById(id);
          wrId = extractWrId(inv);
        } else if (type === 'disbursement' && typeof Disbursement !== 'undefined' && typeof Disbursement._getItem === 'function') {
          const disb = Disbursement._getItem(id);
          wrId = extractWrId(disb);
        } else if (type === 'transmittal' && typeof Transmittal !== 'undefined') {
          const trans = (Transmittal._items || []).find(t => t.id === id) || (Transmittal._detailCache && Transmittal._detailCache[id]);
          wrId = extractWrId(trans);
        }
      }
      if (type === 'transmittal' && window.apiClient?.transmittalCache?.invalidate) {
        window.apiClient.transmittalCache.invalidate();
      }
      if (wrId) {
        invalidateWrRelated(wrId);
      }
    } catch (e) {
      console.error('[apiClient] Error during cache invalidation:', e);
    }
  };

  const withWrInvalidation = (promise, inputData, type, id) => {
    return promise.then((res) => {
      handleMutationInvalidation(res, inputData, type, id);
      return res;
    });
  };

  // Resource-specific API helpers (stubs for now)
  window.apiClient = {
    get,
    post,
    put,
    patch,
    delete: del,

    /**
     * Abort all in-flight GET deduplication requests. Useful on route changes.
     * @param {string|any} [reason='route-change']
     */
    abortRequests(reason = 'route-change') {
      for (const entry of inFlight.values()) {
        try {
          entry.controller.abort(reason);
        } catch (e) {
          // ignore
        }
      }
      inFlight.clear();
    },

    auth: {
      signin: (credentials) => post('/auth/signin', credentials),
    },

    me: {
      get: (options) => {
        const query = options?.query ? '?' + new URLSearchParams(options.query).toString() : '';
        return get(`/me${query}`, options);
      },
      permissions: () => get('/me/permissions'),
      team: () => get('/me/team'),
      update: (body) => patch('/me', body),
      changePassword: (body) => patch('/me/password', body),
      avatarUploadUrl: () => post('/me/avatar-upload-url'),
    },

    userCache: {
      _users: null,
      _promise: null,
      _loadedAt: null,
      TTL_MS: 5 * 60 * 1000,
      _stale() {
        return !this._loadedAt || (Date.now() - this._loadedAt > this.TTL_MS);
      },
      async ensure() {
        if (this._users && !this._stale()) return this._users;
        if (this._promise) return this._promise;
        this._promise = window.apiClient.me.team().then(res => {
          this._users = res.data || [];
          this._loadedAt = Date.now();
          return this._users;
        }).catch(err => {
          this._users = [];
          this._loadedAt = Date.now();
          return this._users;
        }).finally(() => {
          this._promise = null;
        });
        return this._promise;
      },
      getAll() {
        return [...(this._users || [])];
      },
      getById(id) {
        if (!id || !this._users) return null;
        return this._users.find(u => u.id === id) || null;
      },
      getByName(name) {
        if (!name || typeof name !== 'string' || !this._users) return null;
        const target = name.trim().toLowerCase();
        return this._users.find(u => u && typeof u.name === 'string' && u.name.trim().toLowerCase() === target) || null;
      },
      invalidate() {
        this._users = null;
        this._loadedAt = null;
      }
    },

    clientCache: {
      _clients: null,
      _promise: null,
      _loadedAt: null,
      TTL_MS: 5 * 60 * 1000,
      _stale() {
        return !this._loadedAt || (Date.now() - this._loadedAt > this.TTL_MS);
      },
      async ensure() {
        if (this._clients && !this._stale()) return this._clients;
        if (this._promise) return this._promise;
        this._promise = window.apiClient.clients.list({}).then(res => {
          this._clients = (res.data || []).map(c => this._normalize(c));
          this._loadedAt = Date.now();
          return this._clients;
        }).catch(err => {
          this._clients = [];
          this._loadedAt = Date.now();
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
        this._loadedAt = null;
      }
    },

    workRequestCache: {
      _wrs: null,
      _promise: null,
      _loadedAt: null,
      TTL_MS: 5 * 60 * 1000,
      _stale() {
        return !this._loadedAt || (Date.now() - this._loadedAt > this.TTL_MS);
      },
      async ensure() {
        if (this._wrs && !this._stale()) return this._wrs;
        if (this._promise) return this._promise;
        this._promise = window.apiClient.workRequests.list({ includeTasks: true }).then(res => {
          this._wrs = res.data || [];
          this._loadedAt = Date.now();
          return this._wrs;
        }).catch(err => {
          this._wrs = [];
          this._loadedAt = Date.now();
          return this._wrs;
        }).finally(() => {
          this._promise = null;
        });
        return this._promise;
      },
      isActive(wr) {
        return !!wr && !wr.archived && wr.status !== 'Cancelled';
      },
      getActiveByEntity(entity) {
        return (this._wrs || []).filter(wr => this.isActive(wr) && entityMatches(wr.entity, entity));
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
        this._loadedAt = null;
      }
    },

    transmittalCache: {
      _transmittals: null,
      _promise: null,
      _loadedAt: null,
      TTL_MS: 5 * 60 * 1000,
      _stale() {
        return !this._loadedAt || (Date.now() - this._loadedAt > this.TTL_MS);
      },
      async ensure() {
        if (this._transmittals && !this._stale()) return this._transmittals;
        if (this._promise) return this._promise;
        this._promise = window.apiClient.transmittals.list().then(res => {
          this._transmittals = res.data || [];
          this._loadedAt = Date.now();
          return this._transmittals;
        }).catch(err => {
          this._transmittals = [];
          this._loadedAt = Date.now();
          return this._transmittals;
        }).finally(() => {
          this._promise = null;
        });
        return this._promise;
      },
      isActive(t) {
        return !!t && !t.archived && t.status !== 'Cancelled';
      },
      getActiveByEntity(entity) {
        return (this._transmittals || []).filter(t => this.isActive(t) && entityMatches(t.entity_code || t.entityCode || t.entity, entity));
      },
      getById(id) {
        if (!id || !this._transmittals) return null;
        return this._transmittals.find(t => t.id === id) || null;
      },
      getByTrackingNumber(num) {
        if (!num || !this._transmittals) return null;
        return this._transmittals.find(t => (t.tracking_number || t.trackingNumber) === num) || null;
      },
      getByWorkRequestId(wrId) {
        if (!wrId || !this._transmittals) return [];
        return (this._transmittals || []).filter(t => (t.work_request_id || t.workRequestId) === wrId);
      },
      invalidate() {
        this._transmittals = null;
        this._loadedAt = null;
      }
    },

    clients: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/clients${q ? '?' + q : ''}`);
      },
      counts: (entityId) => cachedCount(
        `clients.counts:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/clients/counts', entityId)),
        { data: { active: 0, archived: 0 } }
      ),
      invalidateCounts: () => invalidateCountCache('clients.counts'),
      create: (data) => post('/clients', data).then((res) => { invalidateCountCache('clients.counts'); return res; }),
      get: (id) => get(`/clients/${id}`),
      update: (id, data) => put(`/clients/${id}`, data).then((res) => { invalidateCountCache('clients.counts'); return res; }),
      archive: (id) => post(`/clients/${id}/archive`).then((res) => { invalidateCountCache('clients.counts'); return res; }),
      unarchive: (id) => post(`/clients/${id}/unarchive`).then((res) => { invalidateCountCache('clients.counts'); return res; }),
      remove: (id) => del(`/clients/${id}`).then((res) => { invalidateCountCache('clients.counts'); return res; }),
    },

    documents: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/documents${q ? '?' + q : ''}`);
      },
      counts: (entityId) => cachedCount(
        `documents.counts:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/documents/counts', entityId)),
        { data: { active: 0, archived: 0 } }
      ),
      invalidateCounts: () => invalidateCountCache('documents.counts'),
      create: (data) => post('/documents', data).then((res) => { invalidateCountCache('documents.counts'); return res; }),
      get: (id) => get(`/documents/${id}`),
      update: (id, data) => put(`/documents/${id}`, data).then((res) => { invalidateCountCache('documents.counts'); return res; }),
      archive: (id) => post(`/documents/${id}/archive`).then((res) => { invalidateCountCache('documents.counts'); return res; }),
      unarchive: (id) => post(`/documents/${id}/unarchive`).then((res) => { invalidateCountCache('documents.counts'); return res; }),
      remove: (id) => del(`/documents/${id}`).then((res) => { invalidateCountCache('documents.counts'); return res; }),
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
      counts: (entityId) => cachedCount(
        `workRequests.counts:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/work-requests/counts', entityId)),
        { data: { active: 0, archived: 0 } }
      ),
      invalidateCounts: () => invalidateCountCache('workRequests.counts'),
      create: (data) => post('/work-requests', data).then((res) => { invalidateCountCache('workRequests.counts'); return res; }),
      get: (id) => get(`/work-requests/${id}`),
      update: (id, data, options) => put(`/work-requests/${id}`, data, options).then((res) => { invalidateCountCache('workRequests.counts'); return res; }),
      archive: (id) => post(`/work-requests/${id}/archive`).then((res) => { invalidateCountCache('workRequests.counts'); return res; }),
      unarchive: (id) => post(`/work-requests/${id}/unarchive`).then((res) => { invalidateCountCache('workRequests.counts'); return res; }),
      remove: (id) => del(`/work-requests/${id}`).then((res) => { invalidateCountCache('workRequests.counts'); return res; }),
      getRelated: (id, params) => {
        const q = params ? new URLSearchParams(params).toString() : '';
        return get(`/work-requests/${id}/related${q ? '?' + q : ''}`);
      },
      getTask: (wrId, taskId, queryParams = {}) => {
        const query = new URLSearchParams(queryParams).toString();
        const path = `/work-requests/${wrId}/tasks/${taskId}` + (query ? `?${query}` : '');
        return get(path);
      },
      listTasks: (wrId) => get(`/work-requests/${wrId}/tasks`),
      createTask: (wrId, data) => post(`/work-requests/${wrId}/tasks`, data),
      updateTask: (wrId, taskId, data) => put(`/work-requests/${wrId}/tasks/${taskId}`, data),
      addTimeLogs: (wrId, taskId, data) => post(`/work-requests/${wrId}/tasks/${taskId}/time-logs`, data),
      removeTask: (wrId, taskId) => del(`/work-requests/${wrId}/tasks/${taskId}`),
      listTemplates: () => get('/work-requests/templates'),
      createTemplate: (data) => post('/work-requests/templates', data),
      updateTemplate: (id, data) => put(`/work-requests/templates/${id}`, data),
      deleteTemplate: (id) => del(`/work-requests/templates/${id}`),
      listGroundWorkers: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/work-requests/ground-workers${q ? '?' + q : ''}`);
      },
      createGroundWorker: (data) => post('/work-requests/ground-workers', data),
    },

    operationsRequests: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/operations-requests${q ? '?' + q : ''}`);
      },
      create: (data) => post('/operations-requests', data),
      get: (id) => get(`/operations-requests/${id}`),
      update: (id, data) => put(`/operations-requests/${id}`, data),
      remove: (id) => del(`/operations-requests/${id}`),
      counts: (entityId) => cachedCount(
        `operationsRequests.counts:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/operations-requests/counts', entityId)),
        { data: { total: 0 } }
      ),
      invalidateCounts: () => invalidateCountCache('operationsRequests.counts'),
    },

    tasks: {
      getRelated: (id, params) => {
        const q = params ? new URLSearchParams(params).toString() : '';
        return get(`/tasks/${id}/related${q ? '?' + q : ''}`);
      },
    },

    invoices: {
      list: (query = {}, options = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/invoices${q ? '?' + q : ''}`, options);
      },
      aging: () => get('/invoices/aging'),
      counts: (entityId) => cachedCount(
        `invoices.counts:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/invoices/counts', entityId)),
        { data: { active: 0, archived: 0, rejected: 0, templates: 0 } }
      ),
      invalidateCounts: () => invalidateCountCache('invoices.counts'),
      create: (data) => withWrInvalidation(post('/invoices', data).then((res) => { invalidateCountCache('invoices.counts'); return res; }), data, 'invoice'),
      get: (id) => get(`/invoices/${id}`),
      update: (id, data) => withWrInvalidation(put(`/invoices/${id}`, data).then((res) => { invalidateCountCache('invoices.counts'); return res; }), data, 'invoice', id),
      archive: (id) => withWrInvalidation(post(`/invoices/${id}/archive`).then((res) => { invalidateCountCache('invoices.counts'); return res; }), null, 'invoice', id),
      unarchive: (id) => withWrInvalidation(post(`/invoices/${id}/unarchive`).then((res) => { invalidateCountCache('invoices.counts'); return res; }), null, 'invoice', id),
      remove: (id) => withWrInvalidation(del(`/invoices/${id}`).then((res) => { invalidateCountCache('invoices.counts'); return res; }), null, 'invoice', id),
      recordPayment: (id, data) => withWrInvalidation(post(`/invoices/${id}/payments`, data).then((res) => { invalidateCountCache('invoices.counts'); return res; }), data, 'invoice', id),
      pdf: (id) => get(`/invoices/${id}/pdf`),
      voucher: (id) => get(`/invoices/${id}/voucher`),
      listTemplates: () => get('/invoices/templates'),
      createTemplate: (data) => post('/invoices/templates', data).then((res) => { invalidateCountCache('invoices.counts'); return res; }),
      updateTemplate: (id, data) => put(`/invoices/templates/${id}`, data).then((res) => { invalidateCountCache('invoices.counts'); return res; }),
      deleteTemplate: (id) => del(`/invoices/templates/${id}`).then((res) => { invalidateCountCache('invoices.counts'); return res; }),
    },

    disbursements: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/disbursements${q ? '?' + q : ''}`);
      },
      counts: (entityId) => cachedCount(
        `disbursements.counts:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/disbursements/counts', entityId)),
        { data: { active: 0, archived: 0, rejected: 0 } }
      ),
      invalidateCounts: () => invalidateCountCache('disbursements.counts'),
      create: (data) => withWrInvalidation(post('/disbursements', data).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), data, 'disbursement'),
      get: (id) => get(`/disbursements/${id}`),
      update: (id, data) => withWrInvalidation(put(`/disbursements/${id}`, data).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), data, 'disbursement', id),
      archive: (id) => withWrInvalidation(post(`/disbursements/${id}/archive`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      unarchive: (id) => withWrInvalidation(post(`/disbursements/${id}/unarchive`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      remove: (id) => withWrInvalidation(del(`/disbursements/${id}`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      delete: (id) => withWrInvalidation(del(`/disbursements/${id}`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      submit: (id) => withWrInvalidation(post(`/disbursements/${id}/submit`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      approve: (id) => withWrInvalidation(post(`/disbursements/${id}/approve`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      release: (id) => withWrInvalidation(post(`/disbursements/${id}/release`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      fund: (id) => withWrInvalidation(post(`/disbursements/${id}/fund`).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), null, 'disbursement', id),
      reject: (id, data) => withWrInvalidation(post(`/disbursements/${id}/reject`, data).then((res) => { invalidateCountCache('disbursements.counts'); return res; }), data, 'disbursement', id),
      listTemplates: () => get('/disbursements/templates'),
      createTemplate: (data) => post('/disbursements/templates', data),
      updateTemplate: (id, data) => put(`/disbursements/templates/${id}`, data),
      deleteTemplate: (id) => del(`/disbursements/templates/${id}`),
    },

    transmittals: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/transmittals${q ? '?' + q : ''}`);
      },
      counts: (entityId) => cachedCount(
        `transmittals.counts:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/transmittals/counts', entityId)),
        { data: { active: 0, archived: 0, total: 0 } }
      ),
      invalidateCounts: () => invalidateCountCache('transmittals.counts'),
      create: (data) => withWrInvalidation(post('/transmittals', data).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), data, 'transmittal'),
      get: (id) => get(`/transmittals/${id}`),
      update: (id, data) => withWrInvalidation(put(`/transmittals/${id}`, data).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), data, 'transmittal', id),
      send: (id, data) => withWrInvalidation(post(`/transmittals/${id}/send`, data).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), data, 'transmittal', id),
      approve: (id) => withWrInvalidation(post(`/transmittals/${id}/approve`).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), null, 'transmittal', id),
      acknowledge: (id, data) => withWrInvalidation(post(`/transmittals/${id}/acknowledge`, data).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), data, 'transmittal', id),
      archive: (id) => withWrInvalidation(post(`/transmittals/${id}/archive`).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), null, 'transmittal', id),
      unarchive: (id) => withWrInvalidation(post(`/transmittals/${id}/unarchive`).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), null, 'transmittal', id),
      remove: (id) => withWrInvalidation(del(`/transmittals/${id}`).then((res) => { invalidateCountCache('transmittals.counts'); return res; }), null, 'transmittal', id),
    },

    reports: {
      analytics: () => get('/reports/analytics'),
      dashboard: (options = {}) => get('/reports/dashboard', options),
      daily: (date) => get(`/reports/daily?date=${encodeURIComponent(date)}`),
      weekly: (date) => get(`/reports/weekly?date=${encodeURIComponent(date)}`),
      monthlyPending: (month) => get(`/reports/monthly-pending?month=${encodeURIComponent(month)}`),
      aging: () => get('/reports/aging'),
    },

    admin: {
      listUsers: () => get('/admin/users'),
      createUser: (data) => post('/admin/users', data).then((res) => { invalidateCountCache('admin.auditCount'); return res; }),
      getUser: (id) => get(`/admin/users/${id}`),
      updateUser: (id, data) => put(`/admin/users/${id}`, data).then((res) => { invalidateCountCache('admin.auditCount'); return res; }),
      deleteUser: (id) => del(`/admin/users/${id}`).then((res) => { invalidateCountCache('admin.auditCount'); return res; }),
      listPendingApprovals: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/admin/pending-approvals${q ? '?' + q : ''}`);
      },
      approvePending: (id) => post(`/admin/pending-approvals/${id}/approve`).then((res) => { invalidateCountCache('admin.auditCount'); return res; }),
      rejectPending: (id, data) => post(`/admin/pending-approvals/${id}/reject`, data).then((res) => { invalidateCountCache('admin.auditCount'); return res; }),
      listAudit: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/admin/audit${q ? '?' + q : ''}`);
      },
      auditCount: (entityId) => cachedCount(
        `admin.auditCount:${entityId || getActiveEntity() || 'none'}`,
        () => get(countUrl('/admin/audit/count', entityId)),
        { data: { total: 0 } }
      ),
      invalidateAuditCount: () => invalidateCountCache('admin.auditCount'),
    },

    pendingApprovals: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/admin/pending-approvals${q ? '?' + q : ''}`);
      },
      create: (data) => post('/admin/pending-approvals', data),
      get: (id) => get(`/admin/pending-approvals/${id}`),
      approve: (id) => post(`/admin/pending-approvals/${id}/approve`).then((res) => { invalidateCountCache('admin.auditCount'); return res; }),
      reject: (id, data) => post(`/admin/pending-approvals/${id}/reject`, data).then((res) => { invalidateCountCache('admin.auditCount'); return res; }),
    },

    operations: {
      listTemplates: () => get('/work-requests/templates'),
      createTemplate: (data) => post('/work-requests/templates', data),
      updateTemplate: (id, data) => put(`/work-requests/templates/${id}`, data),
      deleteTemplate: (id) => del(`/work-requests/templates/${id}`),
    },

    groundWorkers: {
      list: (query = {}) => {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
        const q = qs.toString();
        return get(`/work-requests/ground-workers${q ? '?' + q : ''}`);
      },
      create: (data) => post('/work-requests/ground-workers', data),
    },
  };
})();
