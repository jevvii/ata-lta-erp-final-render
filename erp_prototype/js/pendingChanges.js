/**
 * Admin Review Gate — Pending Changes
 * Structural mutations are staged for Admin approval.
 * All non-Admin roles (Manager, Accounting, Operations, Documentation, HR)
 * stage changes through the pending-approvals API for Admin review.
 *
 * Refactor notes:
 * - No module-level Map or localStorage; all pending records live on the server.
 * - Lists/reads/writes go through apiClient.pendingApprovals.
 * - Admin bypass uses the relevant resource APIs directly (workRequests, clients,
 *   invoices, disbursements, transmittals, tasks).
 * - Diff rendering uses the API caches for workRequests/clients and falls back
 *   to null when no cache entry exists.
 */

const PendingChanges = {
  editingPendingId: null,

  /**
   * Normalize a pending-approval record from the API to the shape the UI expects.
   * The backend stores snake_case and exposes camelCase with `tableName`/`createdAt`;
   * the legacy UI uses `table`/`submittedAt`.
   */
  _normalize(pc) {
    if (!pc) return pc;
    return {
      ...pc,
      table: pc.table || pc.tableName,
      submittedAt: pc.submittedAt || pc.createdAt || pc.created_at,
      submittedBy: pc.submittedBy || pc.submitted_by,
      reviewedBy: pc.reviewedBy || pc.reviewed_by,
      reviewedAt: pc.reviewedAt || pc.reviewed_at,
      rejectionReason: pc.rejectionReason || pc.rejection_reason
    };
  },

  _api() {
    return (typeof window !== 'undefined' && window.apiClient) || null;
  },

  /**
   * Look up the current approved record for diff/approval logic.
   * Uses API caches only; no legacy DB fallback.
   */
  _getCurrentRecord(table, id) {
    if (!id) return null;
    const api = this._api();
    if (table === 'workRequests' && api && api.workRequestCache) {
      return api.workRequestCache.getById(id);
    }
    if (table === 'clients' && api && api.clientCache) {
      return api.clientCache.getById(id);
    }
    return null;
  },

  /**
   * Submit a structural change for review.
   * Admin bypasses the gate for everything.
   * Manager bypasses for tasks only (WRs still need Admin approval).
   * All other roles stage changes via the pending-approvals API.
   */
  async submit(table, record, isNew) {
    const api = this._api();
    if (!api) return { approved: false, pendingId: null };

    if (Auth.canBypassReview(table)) {
      await this._adminBypass(table, record, isNew);
      return { approved: true };
    }

    if (this.editingPendingId) {
      const pendingId = this.editingPendingId;
      this.editingPendingId = null;
      // Server-side pending changes are immutable; resubmit as a new pending
      // record and treat the old one as withdrawn.
      const existing = await this.getById(pendingId);
      if (!existing) return { approved: false, pendingId };
      const pc = await api.pendingApprovals.create({
        tableName: table,
        parentRecordId: isNew ? null : record.id,
        proposedData: deepClone(record)
      });
      await api.pendingApprovals.reject(pendingId, { reason: 'Withdrawn by submitter (resubmitted)' }).catch(() => {});
      return { approved: false, pendingId: pc.id };
    }

    const pc = await api.pendingApprovals.create({
      tableName: table,
      parentRecordId: isNew ? null : record.id,
      proposedData: deepClone(record)
    });
    return { approved: false, pendingId: pc.id };
  },

  /**
   * Admin bypass: apply the change directly through the relevant resource API.
   */
  async _adminBypass(table, record, isNew) {
    const api = this._api();
    if (!api) return;
    const cleanRecord = { ...record };
    delete cleanRecord.tasks;

    if (table === 'workRequests') {
      const tasks = record.tasks || [];
      if (isNew) {
        await api.workRequests.create(cleanRecord);
      } else {
        await api.workRequests.update(record.id, cleanRecord);
        const existing = await api.workRequests.listTasks(record.id);
        for (const t of existing || []) {
          await api.workRequests.removeTask(record.id, t.id);
        }
        for (const t of tasks) {
          await api.workRequests.createTask(record.id, t);
        }
      }
      return;
    }

    if (table === 'tasks') {
      const wrId = record.workRequestId;
      if (isNew) {
        await api.workRequests.createTask(wrId, cleanRecord);
      } else {
        await api.workRequests.updateTask(wrId, record.id, cleanRecord);
      }
      return;
    }

    if (table === 'clients') {
      if (isNew) {
        await api.clients.create(cleanRecord);
      } else {
        await api.clients.update(record.id, cleanRecord);
      }
      return;
    }

    if (table === 'invoices') {
      if (isNew) {
        await api.invoices.create(cleanRecord);
      } else {
        await api.invoices.update(record.id, cleanRecord);
      }
      return;
    }

    if (table === 'disbursements') {
      if (isNew) {
        await api.disbursements.create(cleanRecord);
      } else {
        await api.disbursements.update(record.id, cleanRecord);
      }
      return;
    }

    if (table === 'transmittals') {
      if (isNew) {
        await api.transmittals.create(cleanRecord);
      } else {
        await api.transmittals.update(record.id, cleanRecord);
      }
      return;
    }

    throw new Error('Unsupported pending change table for admin bypass: ' + table);
  },

  async getAllPending() {
    const api = this._api();
    if (!api) return [];
    const res = await api.pendingApprovals.list({ status: 'pending' });
    return (res?.data || []).map(pc => this._normalize(pc));
  },

  async getPendingForUser(userId) {
    const api = this._api();
    if (!api) return [];
    const res = await api.pendingApprovals.list({ status: 'pending', submittedBy: userId });
    return (res?.data || []).map(pc => this._normalize(pc));
  },

  async getRejectedForUser(userId) {
    const api = this._api();
    if (!api) return [];
    const res = await api.pendingApprovals.list({ status: 'rejected', submittedBy: userId });
    return (res?.data || []).map(pc => this._normalize(pc));
  },

  async getById(id) {
    const api = this._api();
    if (!api || !id) return null;
    const res = await api.pendingApprovals.get(id);
    return res?.data ? this._normalize(res.data) : null;
  },

  /**
   * Determine if the current user can approve a given pending change.
   * Admin can approve everything.
   * Manager can approve pending tasks (from staff).
   */
  canApproveChange(pc) {
    if (!pc) return false;
    return Auth.canApproveChange(pc.table || pc.tableName);
  },

  async approve(pendingId) {
    const api = this._api();
    if (!api) return false;
    await api.pendingApprovals.approve(pendingId);
    return true;
  },

  async reject(pendingId, reason) {
    const api = this._api();
    if (!api) return false;
    await api.pendingApprovals.reject(pendingId, { reason });
    return true;
  },

  async resubmit(pendingId) {
    const pc = await this.getById(pendingId);
    if (!pc || pc.status !== 'rejected') return false;

    const api = this._api();
    if (!api) return false;

    // Server-side pending changes are immutable; create a fresh pending record
    // with the same proposed data and mark the rejected one as withdrawn.
    await api.pendingApprovals.create({
      tableName: pc.table || pc.tableName,
      parentRecordId: pc.parentRecordId,
      proposedData: deepClone(pc.proposedData)
    });
    await api.pendingApprovals.reject(pendingId, { reason: 'Resubmitted by submitter' }).catch(() => {});
    return true;
  },

  /**
   * Withdraw/delete a pending change. The backend does not expose a delete
   * endpoint, so a pending record is withdrawn by rejecting it with a submitter
   * reason. Already-rejected records are left unchanged.
   */
  async delete(pendingId) {
    const api = this._api();
    if (!api) return false;
    const pc = await this.getById(pendingId);
    if (!pc || pc.status === 'approved') return false;
    if (pc.status === 'pending') {
      await api.pendingApprovals.reject(pendingId, { reason: 'Withdrawn by submitter' });
    }
    return true;
  },

  /**
   * Build a simple key-value diff between current and proposed records.
   */
  buildDiff(pc) {
    const current = pc.parentRecordId ? this._getCurrentRecord(pc.table, pc.parentRecordId) : null;
    const proposed = pc.proposedData;
    const diffs = [];

    const allKeys = new Set([
      ...(current ? Object.keys(current) : []),
      ...Object.keys(proposed)
    ]);

    for (const key of allKeys) {
      if (['id', 'createdAt', 'updatedAt'].includes(key)) continue;
      const oldVal = current ? current[key] : undefined;
      const newVal = proposed[key];
      const oldStr = oldVal === undefined ? '(none)' : JSON.stringify(oldVal);
      const newStr = newVal === undefined ? '(none)' : JSON.stringify(newVal);
      if (oldStr !== newStr) {
        diffs.push({ key, old: oldStr, new: newStr });
      }
    }

    return { current, proposed, diffs, isNew: !pc.parentRecordId };
  },

  renderDiffTable(pc, container) {
    const { current, proposed, diffs, isNew } = this.buildDiff(pc);
    container.innerHTML = '';

    const grid = el('div', { class: 'diff-panel' }, [
      el('div', { class: 'diff-current' }, [
        el('h4', { text: isNew ? '(New Record)' : 'Current (Approved)' }),
        isNew && !current
          ? renderEmptyState('This is a new record', null, { variant: 'compact' })
          : this._renderRecordTable(current)
      ]),
      el('div', { class: 'diff-proposed' }, [
        el('h4', { text: 'Proposed (Pending)' }),
        this._renderRecordTable(proposed)
      ])
    ]);

    container.appendChild(grid);

    if (diffs.length > 0) {
      const diffSection = el('div', { style: 'margin-top:20px;' }, [
        el('h4', { text: 'Changed Fields' }),
        el('table', { class: 'report-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Field' }),
              el('th', { text: 'Current' }),
              el('th', { text: 'Proposed' })
            ])
          ]),
          el('tbody', {}, diffs.map(d =>
            el('tr', {}, [
              el('td', { text: d.key }),
              el('td', { text: d.old }),
              el('td', { style: 'color:var(--color-warning); font-weight:600;', text: d.new })
            ])
          ))
        ])
      ]);
      container.appendChild(diffSection);
    }
  },

  _renderRecordTable(record) {
    if (!record) return renderEmptyState('No data', null, { variant: 'compact' });
    const rows = Object.entries(record)
      .filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k))
      .map(([k, v]) => {
        const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return el('div', { style: 'display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--color-border); font-size:0.8125rem;' }, [
          el('span', { style: 'color:var(--color-text-muted);', text: k }),
          el('span', { text: valStr.length > 80 ? valStr.slice(0, 80) + '…' : valStr })
        ]);
      });
    return el('div', {}, rows);
  }
};
