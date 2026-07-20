/**
 * Admin Panel — Users, Reset Data, Audit Log
 */

const Users = {
  view: 'users', // 'users' | 'audit' | 'pending'
  editingId: null,
  pendingDetailId: null,
  myPendingViewMode: 'table',
  myRequestsViewMode: 'table',
  filters: {
    category: '',
    status: '',
    date: ''
  },
  pendingCategory: sessionStorage.getItem('admin_pending_category') || 'all',
  _counts: { audit: 0, myRequests: 0, pendingRequests: 0 },
  _countTs: { audit: 0, myRequests: 0, pendingRequests: 0 },
  _skipNextListFetch: false,
  _usersLoaded: false,

  /**
   * Cached count of the current user's operations requests.
   * Keeps the tab-badge scan out of the render hot path.
   */
  async countMyRequests() {
    const now = Date.now();
    if (this._countTs.myRequests && (now - this._countTs.myRequests) < 30 * 1000) {
      return this._counts.myRequests;
    }
    let count = 0;
    try {
      const res = await window.apiClient.operationsRequests.list({ requestedBy: Auth.user?.id, limit: 1 });
      count = res?.meta?.total || res?.data?.length || 0;
    } catch (err) {
      console.error('[Users.countMyRequests] failed to load operations request count', err);
    }
    this._counts.myRequests = count;
    this._countTs.myRequests = now;
    return count;
  },

  invalidateMyRequestsCount() {
    this._countTs.myRequests = 0;
  },

  async countPendingRequests() {
    const now = Date.now();
    if (this._countTs.pendingRequests && (now - this._countTs.pendingRequests) < 30 * 1000) {
      return this._counts.pendingRequests;
    }
    let count = 0;
    try {
      const departments = Auth.effectiveDepartments();
      const isAccounting = departments.includes('Accounting');
      const isDocumentation = departments.includes('Documentation');
      const isManagement = departments.includes('Management') || Auth.user?.role === 'Manager';

      const promises = [];
      if (isAccounting || isManagement) {
        promises.push(window.apiClient.operationsRequests.list({ status: 'pending', type: 'billing', limit: 1 }));
        promises.push(window.apiClient.operationsRequests.list({ status: 'pending', type: 'disbursement', limit: 1 }));
      }
      if (isDocumentation || isManagement) {
        promises.push(window.apiClient.operationsRequests.list({ status: 'pending', type: 'transmittal', limit: 1 }));
      }

      const results = await Promise.all(promises);
      count = results.reduce((sum, res) => sum + (res?.meta?.total || res?.data?.length || 0), 0);
    } catch (err) {
      console.error('[Users.countPendingRequests] failed to load pending requests count', err);
    }
    this._counts.pendingRequests = count;
    this._countTs.pendingRequests = now;
    return count;
  },

  invalidatePendingRequestsCount() {
    this._countTs.pendingRequests = 0;
  },

  /**
   * Normalize an audit log row from the API (snake_case created_at) to the
   * camelCase shape the legacy UI expects (timestamp).
   */
  _normalizeAuditLog(l) {
    if (!l) return l;
    return {
      ...l,
      id: l.id,
      action: l.action,
      tableName: l.tableName || l.table_name,
      recordId: l.recordId || l.record_id,
      entity: l.entity,
      userId: l.userId || l.user_id,
      details: l.details,
      timestamp: l.timestamp || l.createdAt || l.created_at
    };
  },

  /**
   * Map a date-bucket label to an ISO from/to range for server-side filtering.
   */
  _dateBucketRange(bucket) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const toIso = (d) => d.toISOString().slice(0, 10);
    switch (bucket) {
      case 'Overdue': {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        return { from: null, to: toIso(yesterday) + 'T23:59:59Z' };
      }
      case 'Due Today':
        return { from: today + 'T00:00:00Z', to: today + 'T23:59:59Z' };
      case 'Due This Week': {
        const endOfWeek = new Date(now);
        endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
        return { from: today + 'T00:00:00Z', to: toIso(endOfWeek) + 'T23:59:59Z' };
      }
      case 'Due This Month': {
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: today + 'T00:00:00Z', to: toIso(endOfMonth) + 'T23:59:59Z' };
      }
      case 'Due Later': {
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return { from: toIso(nextMonth) + 'T00:00:00Z', to: null };
      }
      default:
        return null;
    }
  },

  /**
   * Normalize an operations request row from the API to the camelCase shape
   * the legacy UI expects, handling both Supabase snake_case and existing
   * camelCase fields.
   */
  _normalizeOperationsRequest(r) {
    if (!r) return r;
    return {
      ...r,
      id: r.id,
      type: r.type,
      status: r.status,
      requestedBy: r.requested_by || r.requestedBy,
      requestedAt: r.requested_at || r.requestedAt || r.created_at || r.createdAt,
      fulfilledBy: r.fulfilled_by || r.fulfilledBy,
      fulfilledAt: r.fulfilled_at || r.fulfilledAt,
      rejectionReason: r.rejection_reason || r.rejectionReason,
      workRequestId: r.work_request_id || r.workRequestId,
      clientId: r.client_id || r.clientId,
      amount: typeof r.amount === 'number' ? r.amount : (parseFloat(r.amount) || 0),
      notes: r.notes,
      linkedTaskId: r.linked_task_id || r.linkedTaskId,
      receiptFilename: r.receipt_filename || r.receiptFilename,
      disbursementType: r.disbursement_type || r.disbursementType,
      paymentMethod: r.payment_method || r.paymentMethod,
      recipientDetails: r.recipient_details || r.recipientDetails,
      documents: r.documents
    };
  },

  /**
   * Pre-fetch tab-badge counts so renderTabNav can read them synchronously.
   */
  async loadCounts() {
    const canManageUsers = Auth.can('users:view');
    const departments = Auth.effectiveDepartments();
    const hasAccounting = departments.includes('Accounting');
    const hasDocumentation = departments.includes('Documentation');
    const isManagement = departments.includes('Management') || Auth.user?.role === 'Manager';
    const needsPendingRequests = hasAccounting || hasDocumentation || isManagement;

    try {
      const promises = [
        canManageUsers ? window.apiClient.admin.auditCount() : Promise.resolve({ data: { total: 0 } }),
        this.countMyRequests(),
      ];
      if (needsPendingRequests) {
        promises.push(this.countPendingRequests());
      }
      const [auditRes, myRequests, pendingReqs] = await Promise.all(promises);
      this._counts.audit = auditRes?.data?.total || 0;
      this._counts.myRequests = myRequests || 0;
      if (needsPendingRequests) {
        this._counts.pendingRequests = pendingReqs || 0;
      }
    } catch (err) {
      if (!isAbortError(err)) console.error('Failed to load admin counts', err);
    }

    // Pre-load pending changes so getPendingCategories / renderTabNav can use them synchronously.
    try {
      this._cachedAllPending = await PendingChanges.getAllPending();
    } catch (err) {
      if (!isAbortError(err)) console.error('Failed to preload pending changes', err);
      this._cachedAllPending = [];
    }
    try {
      this._cachedMyPending = await PendingChanges.getPendingForUser(Auth.user?.id);
    } catch (err) {
      if (!isAbortError(err)) console.error('Failed to preload my pending', err);
      this._cachedMyPending = [];
    }
    try {
      this._cachedMyRejected = await PendingChanges.getRejectedForUser(Auth.user?.id);
    } catch (err) {
      if (!isAbortError(err)) console.error('Failed to preload my rejected', err);
      this._cachedMyRejected = [];
    }
  },

  async render() {
    const container = el('div', { class: 'page admin-tab-page' });

    const isAdmin = Auth.user.role === 'Admin';
    const canManageUsers = Auth.can('users:view');
    const departments = Auth.effectiveDepartments();
    const hasOperations = departments.includes('Operations');
    const hasManagement = departments.includes('Management');

    // Initialize view state dynamically to prevent view state bleed-through.
    // Respect URL-driven admin subviews (e.g. #admin/myRequests/:id) so direct
    // links and full-page detail routes are not overwritten.
    const urlAdminView = ((location.hash || '').match(/^#admin\/([^/?]+)/) || [])[1] || null;
    const isManagement = departments.includes('Management') || Auth.user?.role === 'Manager';
    const isManager = isManagement;
    const hasDocOrAcctOrMgr = departments.includes('Accounting') || departments.includes('Documentation') || isManagement;

    if (canManageUsers) {
      const validAdminViews = ['users', 'audit', 'pending'];
      if (isManagement) {
        validAdminViews.push('myPending');
      }
      if (urlAdminView && validAdminViews.includes(urlAdminView)) {
        this.view = urlAdminView;
      } else if (!validAdminViews.includes(this.view)) {
        this.view = 'users';
      }
    } else {
      const showRequestsTab = hasOperations || hasManagement;
      const validViews = ['myPending'];
      if (showRequestsTab) validViews.push('myRequests');
      if (isManager) validViews.push('pending');
      if (hasDocOrAcctOrMgr) validViews.push('pendingRequests');

      if (urlAdminView && validViews.includes(urlAdminView)) {
        this.view = urlAdminView;
      } else if (!validViews.includes(this.view)) {
        this.view = showRequestsTab ? 'myRequests' : 'myPending';
      }
    }

    if (this.lastUserId !== Auth.user.id) {
      this.lastUserId = Auth.user.id;
      this.filters = { category: '', status: '', dateFrom: '', dateTo: '' };
    }

    // Full-page user form is triggered by the URL itself (#admin/users/form/new or .../:id).
    // Side-peek/center-peek launch from the list view without touching the hash, so this
    // branch only runs for full-page/new-tab navigation.
    const isUserFullPage = this.view === 'users' && this.editingId &&
      (location.hash || '').includes('/users/form/');

    // Default pending/request detail views to side-peek unless the user has set a
    // different default for the relevant view context.
    const viewMode = window.SidePaneInstance
      ? window.SidePaneInstance.resolveMode({
          viewContext: (this.view === 'myRequests') ? 'request-detail' : 'pending-detail'
        })
      : PaneMode.SIDE_PEEK;
    const isFullPage = (viewMode === PaneMode.FULL_PAGE || viewMode === PaneMode.NEW_TAB) && this.sidePeekId;

    // Full-page forms render their own breadcrumb header; list/tab views keep the main title.
    if (!isUserFullPage && !isFullPage) {
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      const h1 = el('h1', { class: 'page-title-h1', text: isAdmin ? 'Admin' : 'My Submissions' });
      titleBar.appendChild(h1);
      container.appendChild(titleBar);
    }

    if (isUserFullPage) {
      const isNew = this.editingId === 'new';
      const user = isNew ? null : this.users.find(u => u.id === this.editingId);
      const fullPageRoute = isNew ? '#admin/users/form/new' : `#admin/users/form/${this.editingId}`;

      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'user-form',
        onSidePeek: () => {
          const userId = this.editingId === 'new' ? null : this.editingId;
          closeFormPanelAndRoute('#admin/users');
          this.showUserForm(userId, PaneMode.SIDE_PEEK);
        },
        onCenterPeek: () => {
          const userId = this.editingId === 'new' ? null : this.editingId;
          closeFormPanelAndRoute('#admin/users');
          this.showUserForm(userId, PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });

      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Users',
        baseHash: '#admin/users',
        currentText: isNew ? 'Add User' : 'Edit User',
        viewSwitcher,
        actions: [
          {
            text: isNew ? 'Save User' : 'Save Changes',
            class: 'btn btn-primary btn-sm',
            type: 'submit',
            form: 'user-form'
          },
          {
            text: 'Cancel',
            class: 'btn btn-secondary btn-sm',
            onClick: () => { this.showUserList(); }
          }
        ]
      }));

      const formEl = this.renderUserFormContent(user);
      container.appendChild(formEl);
      return container;
    }

    if (isFullPage) {
      if (this.view === 'myRequests' || this.view === 'pendingRequests') {
        let r = null;
        try {
          const res = await window.apiClient.operationsRequests.get(this.sidePeekId);
          r = this._normalizeOperationsRequest(res?.data);
        } catch (err) {
          console.error('[Users.render] failed to load operations request', err);
        }
        if (r) {
          const fullPageRoute = `#admin/${this.view}/${r.id}`;
          const actions = [];
          const _effDepts = Auth.effectiveDepartments();
          const isAccounting = _effDepts.includes('Accounting');
          const isDocumentation = _effDepts.includes('Documentation');
          const isManagement = _effDepts.includes('Management') || Auth.user?.role === 'Manager';
          const isFulfiller = isManagement || (isAccounting && (r.type === 'billing' || r.type === 'disbursement')) || (isDocumentation && r.type === 'transmittal');

          if (this.view === 'myRequests' && r.status === 'pending') {
            actions.push({
              text: 'Cancel Request',
              class: 'btn btn-danger btn-sm',
              onClick: () => {
                Workflow.showConfirm('Cancel Request', 'Are you sure you want to cancel this request?', async () => {
                  try {
                    await window.apiClient.operationsRequests.remove(r.id);
                  } catch (e) {
                    Workflow.showMessage('Cancel Request', e.message || 'Unable to cancel request.', 'error');
                    return;
                  }
                  Users.invalidateMyRequestsCount();
                  location.hash = '#admin';
                }, 'danger');
              }
            });
          } else if (this.view === 'pendingRequests' && r.status === 'pending' && isFulfiller) {
            actions.push({
              text: 'Fulfill Request',
              class: 'btn btn-success btn-sm',
              onClick: () => {
                this.fulfillRequest(r);
              }
            });
            actions.push({
              text: 'Reject Request',
              class: 'btn btn-danger btn-sm',
              onClick: () => {
                this.rejectRequest(r);
              }
            });
          }

          const viewSwitcher = buildFormViewSwitcher({
            currentMode: PaneMode.FULL_PAGE,
            viewContext: 'request-detail',
            onSidePeek: () => {
              closeFormPanelAndRoute('#admin');
              this.openRequestDetailSidePeek(r, PaneMode.SIDE_PEEK);
            },
            onCenterPeek: () => {
              closeFormPanelAndRoute('#admin');
              this.openRequestDetailSidePeek(r, PaneMode.CENTER_PEEK);
            },
            onNewTab: () => {
              window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
            }
          });

          container.appendChild(buildFormBreadcrumb({
            baseLabel: this.view === 'myRequests' ? 'My Submissions' : 'Pending Requests',
            baseHash: '#admin',
            currentText: `Request Details: ${this._requestTypeLabel(r.type)}`,
            viewSwitcher,
            actions
          }));

          container.appendChild(this.renderRequestDetailContent(r, true));
          return container;
        }
      } else {
        const pc = await PendingChanges.getById(this.sidePeekId);
        if (pc) {
          const isMyPending = this.view === 'myPending';
          const baseLabel = isMyPending ? 'My Submissions' : 'Admin';
          const isNew = !pc.parentRecordId;
          const currentText = pc.title || (isNew ? 'New Submission' : 'Edit Submission');

          const canApprove = PendingChanges.canApproveChange(pc);
          const isSubmitter = pc.submittedBy === Auth.user.id;

          const actions = [];
          if (canApprove) {
            actions.push({
              text: 'Approve Change',
              class: 'btn btn-success btn-sm',
              onClick: () => {
                Workflow.showConfirm('Confirm Approval', 'Are you sure you want to approve this change?', async () => {
                  try {
                    await PendingChanges.approve(pc.id);
                  } catch (e) {
                    Workflow.showMessage('Approve Change', e.message || 'Unable to approve change.', 'error');
                    return;
                  }
                  if (typeof triggerSyncReload === 'function') {
                    await triggerSyncReload('#admin', { title: 'Approve Change', message: 'The request has been successfully approved.' });
                  } else {
                    location.hash = '#admin';
                    App.handleRoute();
                  }
                }, 'success');
              }
            });
            actions.push({
              text: 'Reject',
              class: 'btn btn-danger btn-sm',
              onClick: () => {
                const reason = prompt('Enter rejection reason:');
                if (reason !== null) {
                  Workflow.showConfirm('Confirm Rejection', 'Are you sure you want to reject this change?', async () => {
                    try {
                      await PendingChanges.reject(pc.id, reason);
                    } catch (e) {
                      Workflow.showMessage('Reject Change', e.message || 'Unable to reject change.', 'error');
                      return;
                    }
                    if (typeof triggerSyncReload === 'function') {
                      await triggerSyncReload('#admin', { title: 'Reject Change', message: 'The request has been rejected.', type: 'info' });
                    } else {
                      location.hash = '#admin';
                      App.handleRoute();
                    }
                  }, 'danger');
                }
              }
            });
          } else if (isSubmitter && pc.status === 'pending') {
            actions.push({
              text: 'Withdraw Submission',
              class: 'btn btn-secondary btn-sm',
              onClick: () => {
                Workflow.showConfirm('Confirm Withdrawal', 'Are you sure you want to withdraw this submission?', async () => {
                  try {
                    await PendingChanges.delete(pc.id);
                  } catch (e) {
                    Workflow.showMessage('Withdraw Submission', e.message || 'Unable to withdraw submission.', 'error');
                    return;
                  }
                  if (typeof triggerSyncReload === 'function') {
                    await triggerSyncReload('#admin', { title: 'Withdraw Change', message: 'The submission has been withdrawn.', type: 'info' });
                  } else {
                    location.hash = '#admin';
                    App.handleRoute();
                  }
                }, 'danger');
              }
            });
          }

          const fullPageRoute = isMyPending ? `#admin/myPending/${pc.id}` : `#admin/pending/${pc.id}`;
          const viewSwitcher = buildFormViewSwitcher({
            currentMode: PaneMode.FULL_PAGE,
            viewContext: 'pending-detail',
            onSidePeek: () => {
              closeFormPanelAndRoute('#admin');
              this.openPendingDetailSidePeek(pc, PaneMode.SIDE_PEEK);
            },
            onCenterPeek: () => {
              closeFormPanelAndRoute('#admin');
              this.openPendingDetailSidePeek(pc, PaneMode.CENTER_PEEK);
            },
            onNewTab: () => {
              window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
            }
          });

          container.appendChild(buildFormBreadcrumb({
            baseLabel,
            baseHash: '#admin',
            currentText,
            viewSwitcher,
            actions
          }));

          const detailContent = await this.renderPendingDetail(pc.id, false, true);
          container.appendChild(detailContent);
          return container;
        }
      }
    }

    // Internal Admin tabs use the same module-tab-link style as other pages
    await this.loadCounts();
    container.appendChild(this.renderTabNav());

    if (this.view === 'users' && canManageUsers) {
      container.appendChild(this.renderUsersSection());
    } else if (this.view === 'audit' && canManageUsers) {
      container.appendChild(this.renderAuditSection());
    } else if (this.view === 'pending' && (canManageUsers || isManager)) {
      container.appendChild(await this.renderPendingSection());
    } else if (this.view === 'myPending' && (!canManageUsers || isManager)) {
      container.appendChild(this.renderMyPendingSection());
    } else if (this.view === 'myRequests' && !canManageUsers) {
      container.appendChild(this.renderMyRequestsSection());
    } else if (this.view === 'pendingRequests' && (departments.includes('Accounting') || departments.includes('Documentation') || departments.includes('Management') || Auth.user?.role === 'Manager')) {
      container.appendChild(this.renderPendingRequestsSection());
    } else if (!canManageUsers) {
      if (this.view === 'myRequests') {
        container.appendChild(this.renderMyRequestsSection());
      } else if (this.view === 'pendingRequests' && (departments.includes('Accounting') || departments.includes('Documentation') || departments.includes('Management') || Auth.user?.role === 'Manager')) {
        container.appendChild(this.renderPendingRequestsSection());
      } else if (this.view === 'pending' && isManager) {
        container.appendChild(await this.renderPendingSection());
      } else {
        container.appendChild(this.renderMyPendingSection());
      }
    }

    return container;
  },

  renderTabNav() {
    const canManageUsers = Auth.can('users:view');

    const changeTab = (key) => {
      location.hash = `#admin/${key}`;
    };

    if (canManageUsers) {
      const userCount = (this.users || []).length;
      const auditCount = this._counts.audit;
      const pendingCount = (() => {
        if (typeof this.getPendingCategories !== 'function') return 0;
        const categories = this.getPendingCategories();
        return Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
      })();

      const tabs = [
        { key: 'users', label: 'Users', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', count: userCount },
        { key: 'audit', label: 'Audit Log', icon: BoardCardIcons.document, count: auditCount },
        { key: 'pending', label: 'Pending Approvals', icon: BoardCardIcons.checkCircle, count: pendingCount }
      ];

      const departments = Auth.effectiveDepartments();
      const isManager = departments.includes('Management') || Auth.user?.role === 'Manager';
      if (isManager) {
        const myPendingCount = (this._cachedMyPending || []).length;
        tabs.push({ key: 'myPending', label: 'My Pending Submissions', icon: BoardCardIcons.checklist, count: myPendingCount });
      }

      return renderModuleTabNav(tabs, this.view, changeTab);
    }

    const myPendingCount = (this._cachedMyPending || []).length;
    const tabs = [
      { key: 'myPending', label: 'My Pending Submissions', icon: BoardCardIcons.checklist, count: myPendingCount }
    ];
    const departments = Auth.effectiveDepartments();
    const isManagement = departments.includes('Management') || Auth.user?.role === 'Manager';
    if (departments.includes('Accounting') || departments.includes('Documentation') || isManagement) {
      tabs.push({ key: 'pendingRequests', label: 'Pending Requests', icon: BoardCardIcons.document, count: this._counts.pendingRequests || 0 });
    }
    const hasOperations = departments.includes('Operations');
    const hasManagement = departments.includes('Management');
    const showRequestsTab = hasOperations || hasManagement;
    if (showRequestsTab) {
      tabs.push({ key: 'myRequests', label: 'My Requests', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>', count: this._counts.myRequests });
    }
    const isManager = hasManagement || Auth.user?.role === 'Manager';
    if (isManager) {
      const pendingCount = (() => {
        if (typeof this.getPendingCategories !== 'function') return 0;
        const categories = this.getPendingCategories();
        return Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
      })();
      tabs.push({ key: 'pending', label: 'Pending Approvals', icon: BoardCardIcons.checkCircle, count: pendingCount });
    }
    return renderModuleTabNav(tabs, this.view, changeTab);
  },

  updateBreadcrumb(h1, subpage) {
    if (!h1) h1 = document.getElementById('admin-breadcrumb-h1');
    if (!h1) return;
    this.clearNode(h1);
    const isAdmin = Auth.user.role === 'Admin';
    const sectionLabel = (() => {
      if (this.pendingDetailId) return 'Review Pending Change';
      if (subpage) return subpage;
      switch (this.view) {
        case 'audit': return 'Audit Log';
        case 'pending': return 'Pending Approvals';
        case 'myPending': return 'My Pending Submissions';
        case 'myRequests': return 'My Requests';
        case 'pendingRequests': return 'Pending Requests';
        default: return isAdmin ? 'Admin' : 'My Submissions';
      }
    })();

    if (this.view !== 'users' || this.pendingDetailId || subpage) {
      const baseLink = el('a', { href: 'javascript:void(0)', class: 'breadcrumb-base', text: isAdmin ? 'Admin' : 'My Submissions' });
      baseLink.addEventListener('click', () => {
        this.pendingDetailId = null;
        this.editingId = null;
        const hash = location.hash;
        const needsHashReset = hash.startsWith('#admin/pending/') || 
                               hash.startsWith('#admin/myPending/') || 
                               hash.startsWith('#admin/myRequests/') || 
                               hash.startsWith('#admin/pendingRequests/');
        if (isAdmin) {
          if (this.view === 'users') {
            this.showUserList();
          } else {
            if (needsHashReset) {
              location.hash = '#admin';
            } else {
              App.handleRoute();
            }
          }
        } else {
          if (needsHashReset) {
            location.hash = '#admin';
          } else {
            App.handleRoute();
          }
        }
      });
      h1.appendChild(baseLink);
      h1.appendChild(el('span', { class: 'breadcrumb-sep', text: ' / ' }));
      h1.appendChild(document.createTextNode(sectionLabel));
    } else {
      h1.appendChild(document.createTextNode(sectionLabel));
    }
  },

  async init() {
    await Promise.all([
      window.apiClient.workRequestCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.userCache.ensure()
    ]);

    if (this.editingId) {
      const userViewMode = window.SidePaneInstance ? window.SidePaneInstance.resolveMode({ viewContext: 'user-form' }) : 'side-peek';
      // Direct URL / new-tab full-page routes carry the form path in the hash.
      const isUserFullPage = (userViewMode === 'full-page' || userViewMode === 'new-tab') ||
        (location.hash || '').includes('/users/form/');
      if (!isUserFullPage) {
        this.showUserForm(this.editingId === 'new' ? null : this.editingId);
      }
    } else if (this.sidePeekId) {
      // Default pending/request detail views to side-peek unless the user has set a
      // different default for the relevant view context.
      const viewMode = window.SidePaneInstance
        ? window.SidePaneInstance.resolveMode({
            viewContext: (this.view === 'myRequests' || this.view === 'pendingRequests') ? 'request-detail' : 'pending-detail'
          })
        : PaneMode.SIDE_PEEK;
      const isFullPage = (viewMode === PaneMode.FULL_PAGE || viewMode === PaneMode.NEW_TAB);

      if (!isFullPage) {
        if (this.view === 'pending' || this.view === 'myPending') {
          const pc = await PendingChanges.getById(this.sidePeekId);
          if (pc) {
            this.openPendingDetailSidePeek(pc, viewMode);
          }
        } else if (this.view === 'myRequests' || this.view === 'pendingRequests') {
          let r = null;
          try {
            const res = await window.apiClient.operationsRequests.get(this.sidePeekId);
            r = this._normalizeOperationsRequest(res?.data);
          } catch (err) {
            console.error('[Users.init] failed to load operations request', err);
          }
          if (r) {
            this.openRequestDetailSidePeek(r, viewMode);
          }
        }
      }
    } else {
      if (window.SidePaneInstance && window.SidePaneInstance.isOpen()) {
        const ctx = window.SidePaneInstance.options.viewContext;
        if (ctx === 'pending-detail' || ctx === 'request-detail' || ctx === 'user-form') {
          window.SidePaneInstance.close({ silent: true });
        }
      }
    }
  },

  async openPendingDetailSidePeek(pc, mode = null) {
    const isMyPending = this.view === 'myPending';
    const fullPageRoute = isMyPending ? `#admin/myPending/${pc.id}` : `#admin/pending/${pc.id}`;
    const title = `Pending Change: ${pc.title || 'Review'}`;
    const content = await this.renderPendingDetail(pc.id, true);
    window.SidePaneInstance.open({
      title,
      content,
      mode,
      viewContext: 'pending-detail',
      recordId: pc.id,
      fullPageRoute,
      newTabRoute: fullPageRoute,
      onClose: () => {
        const hash = location.hash;
        if (hash.startsWith('#admin/pending/') || hash.startsWith('#admin/myPending/')) {
          location.hash = '#admin';
        }
      }
    });
  },

  renderRequestDetailContent(r, isFullPage = false) {
    const self = this;
    const wr = window.apiClient.workRequestCache.getById(r.workRequestId);
    const client = window.apiClient.clientCache.getById(r.clientId);
    const submitter = window.apiClient.userCache.getById(r.requestedBy);

    const wrapper = el('div', { class: 'form-stacked notion-form', style: 'padding: var(--spacing-xs); display: flex; flex-direction: column; gap: var(--spacing-md);' });

    // Status / Submitter info box
    const infoBox = el('div', { 
      style: 'background: var(--color-bg-light); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--spacing-sm); display: flex; flex-direction: column; gap: var(--spacing-xs);' 
    }, [
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
        el('span', { text: 'Status', style: 'font-size:0.75rem; color:var(--color-text-muted); font-weight:600; text-transform:uppercase;' }),
        self._requestStatusBadge(r.status)
      ]),
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
        el('span', { text: 'Submitted By', style: 'font-size:0.75rem; color:var(--color-text-muted); font-weight:600; text-transform:uppercase;' }),
        el('span', { text: submitter ? submitter.name : '—', style: 'font-weight:500;' })
      ]),
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
        el('span', { text: 'Submitted At', style: 'font-size:0.75rem; color:var(--color-text-muted); font-weight:600; text-transform:uppercase;' }),
        el('span', { text: formatDate(r.requestedAt), style: 'font-weight:500;' })
      ])
    ]);
    wrapper.appendChild(infoBox);

    // Notion-style Property Grid
    const grid = el('div', { class: 'notion-property-grid', style: 'margin-bottom: var(--spacing-xs);' });

    const addProp = (label, valueNode) => {
      const row = el('div', { class: 'notion-property-row' });
      row.appendChild(el('div', { class: 'notion-property-label', text: label }));
      row.appendChild(el('div', { class: 'notion-property-value' }, [valueNode]));
      grid.appendChild(row);
    };

    addProp('Request Type', document.createTextNode(this._requestTypeLabel(r.type)));
    addProp('Client', document.createTextNode(client ? client.name : '—'));
    
    // Work Request Link / Text
    const wrSpan = el('span', { text: wr ? wr.title : '—' });
    if (wr) {
      wrSpan.style.cursor = 'pointer';
      wrSpan.style.color = 'var(--color-primary)';
      wrSpan.style.textDecoration = 'underline';
      wrSpan.addEventListener('click', () => {
        location.hash = `#operations/detail/${wr.id}`;
      });
    }
    addProp('Work Request', wrSpan);

    // Render type-specific fields
    if (r.type === 'billing') {
      const linkedTask = r.linkedTaskId ? (wr?.tasks || []).find(t => t.id === r.linkedTaskId) : null;
      addProp('Linked Task', document.createTextNode(linkedTask ? linkedTask.title : '— Whole Project —'));
      addProp('Amount', el('strong', { text: (r.amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'PHP' }) }));
      if (r.receiptFilename) {
        addProp('Receipt File', el('span', { text: r.receiptFilename, style: 'font-family: monospace;' }));
      }
    } else if (r.type === 'disbursement') {
      const linkedTask = r.linkedTaskId ? (wr?.tasks || []).find(t => t.id === r.linkedTaskId) : null;
      addProp('Disbursement Type', document.createTextNode(r.disbursementType ? r.disbursementType.charAt(0).toUpperCase() + r.disbursementType.slice(1) : '—'));
      addProp('Category', document.createTextNode(r.category || '—'));
      addProp('Amount', el('strong', { text: (r.amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'PHP' }) }));
      addProp('Payment Method', document.createTextNode(r.paymentMethod || '—'));
      if (linkedTask) {
        addProp('Linked Task', document.createTextNode(linkedTask.title));
      }
      if (r.receiptFilename) {
        addProp('Receipt File', el('span', { text: r.receiptFilename, style: 'font-family: monospace;' }));
      }
    } else if (r.type === 'transmittal') {
      addProp('Recipient & Delivery', document.createTextNode(r.recipientDetails || '—'));
    }

    wrapper.appendChild(grid);

    // Documents list for Transmittal
    if (r.type === 'transmittal' && r.documents && r.documents.length > 0) {
      wrapper.appendChild(el('h4', { text: 'Documents to Transmit', style: 'margin-top:var(--spacing-xs); margin-bottom:var(--spacing-xs); font-size:0.875rem;' }));
      const docList = el('ul', { style: 'padding-left: var(--spacing-md); margin-bottom: var(--spacing-sm); display:flex; flex-direction:column; gap:4px;' });
      r.documents.forEach(doc => {
        docList.appendChild(el('li', { text: doc, style: 'font-size:0.875rem;' }));
      });
      wrapper.appendChild(docList);
    }

    // Notes
    if (r.notes) {
      wrapper.appendChild(el('h4', { text: 'Notes', style: 'margin-top:var(--spacing-xs); margin-bottom:var(--spacing-xs); font-size:0.875rem;' }));
      wrapper.appendChild(el('div', { 
        text: r.notes, 
        style: 'background: var(--color-bg-light); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--spacing-sm); font-size: 0.875rem; white-space: pre-wrap; font-style: italic;' 
      }));
    }

    // Fulfillment Details or Rejection Details
    if (r.status === 'fulfilled') {
      const fulfiller = window.apiClient.userCache.getById(r.fulfilledBy);
      wrapper.appendChild(el('h4', { text: 'Fulfillment Info', style: 'margin-top:var(--spacing-sm); margin-bottom:var(--spacing-xs); font-size:0.875rem; color:var(--success);' }));
      const fulfillBox = el('div', {
        style: 'background: color-mix(in oklab, var(--success), transparent 95%); border: 1px solid color-mix(in oklab, var(--success), transparent 70%); border-radius: var(--radius-sm); padding: var(--spacing-sm); font-size:0.875rem;'
      }, [
        el('div', { text: `Fulfilled by: ${fulfiller ? fulfiller.name : 'System'}` }),
        el('div', { text: `Fulfilled at: ${formatDate(r.fulfilledAt)}`, style: 'margin-top:4px;' })
      ]);
      wrapper.appendChild(fulfillBox);
    } else if (r.status === 'rejected') {
      const rejecter = r.fulfilledBy ? window.apiClient.userCache.getById(r.fulfilledBy) : null;
      wrapper.appendChild(el('h4', { text: 'Rejection Info', style: 'margin-top:var(--spacing-sm); margin-bottom:var(--spacing-xs); font-size:0.875rem; color:var(--danger);' }));
      const rejectBox = el('div', {
        style: 'background: color-mix(in oklab, var(--danger), transparent 95%); border: 1px solid color-mix(in oklab, var(--danger), transparent 70%); border-radius: var(--radius-sm); padding: var(--spacing-sm); font-size:0.875rem;'
      }, [
        el('div', { text: `Reason: ${r.rejectionReason || 'No reason provided'}` }),
        rejecter ? el('div', { text: `Rejected by: ${rejecter.name}`, style: 'margin-top:4px;' }) : null,
        r.fulfilledAt ? el('div', { text: `Rejected at: ${formatDate(r.fulfilledAt)}`, style: 'margin-top:4px;' }) : null
      ].filter(Boolean));
      wrapper.appendChild(rejectBox);
    }

    if (isFullPage) {
      const outer = el('div', { class: 'request-detail-full-page' });
      outer.appendChild(wrapper);
      return outer;
    }
    return wrapper;
  },

  openRequestDetailSidePeek(r, mode = null) {
    const wrapper = this.renderRequestDetailContent(r);
    const _effDepts2 = Auth.effectiveDepartments();
    const isAccounting = _effDepts2.includes('Accounting');
    const isDocumentation = _effDepts2.includes('Documentation');
    const isManagement = _effDepts2.includes('Management') || Auth.user?.role === 'Manager';
    const isFulfiller = isManagement || (isAccounting && (r.type === 'billing' || r.type === 'disbursement')) || (isDocumentation && r.type === 'transmittal');

    if (r.status === 'pending') {
      const footerActions = el('div', { class: 'side-pane-form-footer' });
      if (this.view === 'myRequests') {
        const cancelBtn = el('button', { class: 'btn btn-danger', text: 'Cancel Request' });
        cancelBtn.addEventListener('click', () => {
          Workflow.showConfirm('Cancel Request', 'Are you sure you want to cancel this request?', async () => {
            try {
              await window.apiClient.operationsRequests.remove(r.id);
            } catch (e) {
              Workflow.showMessage('Cancel Request', e.message || 'Unable to cancel request.', 'error');
              return;
            }
            Users.invalidateMyRequestsCount();
            if (location.hash.includes('/')) {
              location.hash = location.hash.split('/')[0];
            } else {
              App.handleRoute();
            }
          }, 'danger');
        });
        footerActions.appendChild(cancelBtn);
      } else if (this.view === 'pendingRequests' && isFulfiller) {
        const fulfillBtn = el('button', { class: 'btn btn-success', text: 'Fulfill Request', style: 'margin-right: 8px;' });
        fulfillBtn.addEventListener('click', () => {
          this.fulfillRequest(r);
        });
        const rejectBtn = el('button', { class: 'btn btn-danger', text: 'Reject Request' });
        rejectBtn.addEventListener('click', () => {
          this.rejectRequest(r);
        });
        footerActions.appendChild(fulfillBtn);
        footerActions.appendChild(rejectBtn);
      }
      wrapper.appendChild(footerActions);
    }

    const title = `Request Details: ${this._requestTypeLabel(r.type)}`;
    const fullPageRoute = `#admin/${this.view}/${r.id}`;
    window.SidePaneInstance.open({
      title,
      content: wrapper,
      mode,
      viewContext: 'request-detail',
      recordId: r.id,
      fullPageRoute,
      newTabRoute: fullPageRoute,
      onClose: () => {
        const hash = location.hash;
        if (hash.startsWith('#admin/myRequests/') || hash.startsWith('#admin/pendingRequests/')) {
          location.hash = '#admin';
        }
      }
    });
  },

  // ============================================================
  // Users Section
  // ============================================================
  users: [],

  async loadUsers() {
    if (this._usersLoaded) return;
    try {
      const res = await window.apiClient.admin.listUsers();
      this.users = res.data || [];
      this._usersLoaded = true;
    } catch (e) {
      this.users = [];
      this._usersLoaded = false;
      if (!isAbortError(e)) {
        Workflow.showMessage('Users', 'Unable to load users from the server.', 'error');
      }
    }
  },

  invalidateCache() {
    this._usersLoaded = false;
    this._skipNextListFetch = false;
  },

  hasCachedData(entity) {
    // Users are global (not entity-scoped); the cache is valid once loaded.
    return this._usersLoaded && Array.isArray(this.users);
  },

  renderUsersSection() {
    const wrapper = el('div', { class: 'page-content-section' });

    // List container (forms open in the shared side-peek panel, not inline)
    const listContainer = el('div', { class: 'list-container' });
    wrapper.appendChild(listContainer);
    this.renderUserList(listContainer);

    return wrapper;
  },

  clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  },

  async renderUserList(container) {
    this.clearNode(container);
    if (this._skipNextListFetch) {
      this._skipNextListFetch = false;
    } else {
      await this.loadUsers();
    }
    const users = this.users;

    if (users.length === 0) {
      container.appendChild(renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>',
        title: 'No users found',
        body: 'Add users to start managing credentials and roles.',
        actions: [
          {
            text: '+ Add User',
            className: 'btn btn-primary btn-sm',
            onClick: () => this.showUserForm()
          }
        ]
      }));
      return;
    }

    const items = users.map((u, idx) => {
      const depts = Array.isArray(u.departments) ? u.departments : [];
      const deptText = depts.length
        ? depts.map(d => {
            const cleanDept = d.toLowerCase().replace(/[^a-z0-9]/g, '');
            return `<span class="user-dept-badge user-dept-badge--${cleanDept}">${escapeHtml(d)}</span>`;
          }).join('')
        : '<span class="text-muted">No departments</span>';
      return {
        id: u.id,
        keyText: 'USR-' + String(idx + 1).padStart(2, '0'),
        name: u.name,
        iconHtml: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        tags: [
          { isHtml: true, text: deptText, type: 'department' },
          { text: u.email, type: 'category' },
          { text: (u.entities || []).join(', ') || 'No entities', type: 'client' },
          { text: u.isActive !== false ? 'Active' : 'Disabled', type: 'status', className: u.isActive !== false ? 'jira-backlog-tag-status-active' : 'jira-backlog-tag-status-disabled' }
        ]
      };
    });

    const backlog = JiraBacklogList.render({
      title: 'Team Members',
      subtitle: 'users, departments, and entity access',
      items,
      emptyText: 'No users found',
      rowIdPrefix: 'USR',
      countLabel: 'user',
      bulkActions: (selectedIds) => [
        {
          text: 'Disable',
          className: 'btn btn-outline-warning btn-sm',
          onClick: (ids) => {
            const hasSelf = ids.includes(Auth.user.id);
            const targetIds = ids.filter(id => id !== Auth.user.id);

            if (targetIds.length === 0) {
              Workflow.showMessage('Error', 'You cannot disable your own user account.', 'error');
              return;
            }

            let message = `Are you sure you want to disable ${targetIds.length} selected user${targetIds.length === 1 ? '' : 's'}?`;
            if (hasSelf) {
              message += ' (Your own account will not be disabled.)';
            }

            Workflow.showConfirm('Disable Users', message, async () => {
              const removed = [];
              targetIds.forEach(id => {
                const idx = this.users.findIndex(u => u.id === id);
                if (idx !== -1) {
                  removed.push({ user: this.users.splice(idx, 1)[0], index: idx });
                }
              });
              if (removed.length > 0) {
                this._skipNextListFetch = true;
                App.handleRoute();
              }

              const failures = [];
              for (const { user, index } of removed) {
                try {
                  await window.apiClient.admin.deleteUser(user.id);
                } catch (e) {
                  console.error('Failed to disable user', user.id, e);
                  failures.push({ user, index, error: e.message || 'Unable to disable user.' });
                }
              }

              if (failures.length > 0) {
                failures.forEach(({ user, index }) => {
                  this.users.splice(Math.min(index, this.users.length), 0, user);
                });
                this._skipNextListFetch = true;
                App.handleRoute();
                const summary = failures.length === 1
                  ? failures[0].error
                  : `${failures.length} of ${targetIds.length} users could not be disabled.`;
                Workflow.showMessage('Error', summary, 'error');
              }
            }, 'warning');
          }
        },
        {
          text: 'Delete',
          className: 'btn btn-danger btn-sm',
          onClick: (ids) => {
            const hasSelf = ids.includes(Auth.user.id);
            const targetIds = ids.filter(id => id !== Auth.user.id);

            if (targetIds.length === 0) {
              Workflow.showMessage('Error', 'You cannot delete your own user account.', 'error');
              return;
            }

            let message = `Are you sure you want to permanently delete ${targetIds.length} selected user${targetIds.length === 1 ? '' : 's'}? This cannot be undone.`;
            if (hasSelf) {
              message += ' (Your own account will not be deleted.)';
            }

            Workflow.showConfirm('Delete Users', message, async () => {
              const removed = [];
              targetIds.forEach(id => {
                const idx = this.users.findIndex(u => u.id === id);
                if (idx !== -1) {
                  removed.push({ user: this.users.splice(idx, 1)[0], index: idx });
                }
              });
              if (removed.length > 0) {
                this._skipNextListFetch = true;
                App.handleRoute();
              }

              const failures = [];
              for (const { user, index } of removed) {
                try {
                  await window.apiClient.admin.deleteUser(user.id);
                } catch (e) {
                  console.error('Failed to delete user', user.id, e);
                  failures.push({ user, index, error: e.message || 'Unable to delete user.' });
                }
              }

              if (failures.length > 0) {
                failures.forEach(({ user, index }) => {
                  this.users.splice(Math.min(index, this.users.length), 0, user);
                });
                this._skipNextListFetch = true;
                App.handleRoute();
                const summary = failures.length === 1
                  ? failures[0].error
                  : `${failures.length} of ${targetIds.length} users could not be deleted.`;
                Workflow.showMessage('Error', summary, 'error');
              }
            }, 'danger');
          }
        }
      ],
      columns: [
        { label: 'Department', width: '180px', align: 'left' },
        { label: 'Email', width: '200px', align: 'left' },
        { label: 'Entities', width: '120px', align: 'left' },
        { label: 'Status', width: '90px', align: 'left' }
      ],
      headerActions: [
        {
          text: '+ Add User',
          className: 'btn btn-primary btn-sm',
          onClick: () => this.showUserForm()
        }
      ],
      rowActions: (item) => {
        const user = users.find(u => u.id === item.id);
        if (!user) return [];
        return [
          {
            text: 'Edit',
            className: 'btn btn-secondary btn-xs',
            onClick: () => this.showUserForm(user.id)
          }
        ];
      }
    });

    container.appendChild(backlog);
  },

  roleBadge(role) {
    const map = {
      'Admin': 'badge-danger',
      'Manager': 'badge-warning',
      'Accounting': 'badge-info',
      'Operations': 'badge-success',
      'Documentation': 'badge-primary'
    };
    return el('span', { class: 'badge ' + (map[role] || ''), text: role });
  },

  renderUserFormContent(user) {
    const form = el('form', { id: 'user-form', class: 'form-stacked notion-form' });

    // Title-style primary field: name
    const nameSection = el('div', { class: 'notion-freeform notion-freeform--title' });
    nameSection.appendChild(el('label', { class: 'notion-section-label', text: 'Full Name' }));
    const nameInput = el('input', {
      type: 'text',
      name: 'name',
      class: 'notion-freeform-input notion-title-input',
      placeholder: 'e.g. Juan Dela Cruz',
      required: true,
      value: user ? (user.name || '') : ''
    });
    nameSection.appendChild(nameInput);
    nameSection.appendChild(el('span', { class: 'field-error hidden', text: '' }));
    form.appendChild(nameSection);

    const propsGrid = el('div', { class: 'notion-property-grid' });

    // Email
    const emailProp = el('div', { class: 'notion-prop' });
    emailProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email' }));
    emailProp.appendChild(el('input', {
      type: 'email',
      name: 'email',
      class: 'notion-prop-input',
      placeholder: 'user@example.com',
      required: true,
      value: user ? (user.email || '') : ''
    }));
    emailProp.appendChild(el('span', { class: 'field-error hidden', text: '' }));
    propsGrid.appendChild(emailProp);

    // Password
    const pwProp = el('div', { class: 'notion-prop' });
    pwProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Password' }));
    pwProp.appendChild(el('input', {
      type: 'password',
      name: 'password',
      class: 'notion-prop-input',
      placeholder: user ? 'Leave blank to keep current' : 'Set password',
      required: !user
    }));
    pwProp.appendChild(el('span', { class: 'field-error hidden', text: '' }));
    propsGrid.appendChild(pwProp);

    // Department (multi-select); skip for Admin because Admin is all-powerful.
    if (!user || user.role !== 'Admin') {
      const deptProp = el('div', { class: 'notion-prop' });
      deptProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg> Department' }));
      const deptWrap = el('div', { class: 'notion-checkbox-group' });
      const departmentList = Auth.DEPARTMENTS;
      departmentList.forEach(d => {
        const label = el('label', { class: 'checkbox-label' });
        const cb = el('input', { type: 'checkbox', name: 'departments', value: d });
        if (user && Array.isArray(user.departments) && user.departments.includes(d)) cb.checked = true;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + d));
        deptWrap.appendChild(label);
      });
      deptProp.appendChild(deptWrap);
      deptProp.appendChild(el('span', { class: 'field-error hidden', text: '' }));
      propsGrid.appendChild(deptProp);
    }

    // Entity access
    const entityProp = el('div', { class: 'notion-prop' });
    entityProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Entity Access' }));
    const entityWrap = el('div', { class: 'notion-checkbox-group' });
    ['ATA', 'LTA'].forEach(e => {
      const label = el('label', { class: 'checkbox-label' });
      const cb = el('input', { type: 'checkbox', name: 'entities', value: e });
      if (user && user.entities && user.entities.includes(e)) cb.checked = true;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + e));
      entityWrap.appendChild(label);
    });
    entityProp.appendChild(entityWrap);
    entityProp.appendChild(el('span', { class: 'field-error hidden', text: '' }));
    propsGrid.appendChild(entityProp);

    form.appendChild(propsGrid);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.submitUserForm(form);
    });

    return form;
  },

  showUserForm(userId, mode = null) {
    this.editingId = userId || 'new';
    const user = userId ? this.users.find(u => u.id === userId) : null;
    const form = this.renderUserFormContent(user);

    const fullPageRoute = userId ? `#admin/users/form/${userId}` : '#admin/users/form/new';

    openFormPanel({
      icon: '👤',
      title: userId ? 'Edit User' : 'Add User',
      formContent: form,
      formId: 'user-form',
      mode,
      viewContext: 'user-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: userId ? 'Save Changes' : 'Save User', class: 'btn btn-primary', type: 'submit', form: 'user-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => this.showUserList() }
      ]
    });
  },

  showUserList() {
    this.editingId = null;
    closeFormPanelAndRoute('#admin/users');
    this.updateBreadcrumb(null);
  },

  async submitUserForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const entityCheckboxes = form.querySelectorAll('input[name="entities"]:checked');
    const entities = Array.from(entityCheckboxes).map(cb => cb.value);
    const allowedDepartments = Auth.DEPARTMENTS;
    const departmentCheckboxes = form.querySelectorAll('input[name="departments"]:checked');
    let departments = Array.from(departmentCheckboxes).map(cb => cb.value);
    const hasDeptField = form.querySelector('input[name="departments"]') !== null;

    // Preserve existing department assignments when the department field is not
    // rendered (e.g. Admin users) or when no checkboxes are checked on edit.
    // Filter against the allowed department list so legacy/disallowed assignments
    // are stripped on save.
    if (this.editingId && departments.length === 0) {
      const existing = this.users.find(u => u.id === this.editingId);
      if (existing && Array.isArray(existing.departments) && existing.departments.length > 0) {
        departments = existing.departments.filter(d => allowedDepartments.includes(d));
      }
    }

    // Derive a legacy role for compatibility and keep it in sync with department assignments.
    let role = null;
    const existing = this.editingId ? this.users.find(u => u.id === this.editingId) : null;
    if (existing && existing.role === 'Admin') {
      role = 'Admin';
    } else if (departments.includes('Management')) {
      role = 'Manager';
    } else if (departments.length > 0) {
      role = departments[0];
    } else {
      role = existing?.role || null;
    }

    // Final sanitization: only permitted departments may be saved.
    departments = departments.filter(d => allowedDepartments.includes(d));

    // Clear previous errors
    form.querySelectorAll('.field-error').forEach(e => { e.classList.add('hidden'); e.textContent = ''; });

    const errors = [];
    if (!data.name || data.name.trim().length < 2) {
      errors.push({ field: 'name', msg: 'Name is required (min 2 characters).' });
    }
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.push({ field: 'email', msg: 'Please enter a valid email address.' });
    }
    if (!this.editingId && (!data.password || data.password.length < 1)) {
      errors.push({ field: 'password', msg: 'Password is required for new users.' });
    }
    if (entities.length === 0) {
      errors.push({ field: 'entities', msg: 'At least one entity must be selected.' });
    }
    if (hasDeptField && departments.length === 0) {
      errors.push({ field: 'departments', msg: 'At least one department must be selected.' });
    }

    if (errors.length > 0) {
      errors.forEach(err => {
        const field = form.querySelector('[name="' + err.field + '"]');
        const group = field && field.closest('.notion-prop, .notion-freeform');
        const elErr = group && group.querySelector('.field-error');
        if (elErr) {
          elErr.textContent = err.msg;
          elErr.classList.remove('hidden');
        }
      });
      return;
    }

    const record = {
      name: data.name.trim(),
      email: data.email.trim(),
      role: role,
      departments: departments,
      entities: entities,
      isActive: true
    };

    try {
      if (this.editingId) {
        if (data.password && data.password.trim()) {
          record.password = data.password.trim();
        }
        await window.apiClient.admin.updateUser(this.editingId, record);
        // Patch the shared cache in place rather than wiping it, so dropdowns stay populated.
        if (window.apiClient?.userCache && Array.isArray(window.apiClient.userCache._users)) {
          const uidx = window.apiClient.userCache._users.findIndex(u => u.id === this.editingId);
          if (uidx >= 0) {
            window.apiClient.userCache._users[uidx] = { ...window.apiClient.userCache._users[uidx], ...record, id: this.editingId };
          }
        }
        this.showUserList();
      } else {
        record.password = data.password.trim();
        const optimisticId = generateId('usr-opt');
        const optimisticUser = {
          id: optimisticId,
          ...record,
          createdAt: new Date().toISOString()
        };
        this.users.unshift(optimisticUser);
        this._usersLoaded = true;
        this._skipNextListFetch = true;
        this.showUserList();

        try {
          const res = await window.apiClient.admin.createUser(record);
          const serverUser = res?.data || res;
          const idx = this.users.findIndex(u => u.id === optimisticId);
          if (serverUser && idx !== -1) {
            this.users[idx] = serverUser;
          }
          // Keep the shared user cache warm so assignee/dropdown pickers stay usable.
          if (window.apiClient?.userCache) {
            if (!Array.isArray(window.apiClient.userCache._users)) {
              window.apiClient.userCache._users = [serverUser];
            } else {
              const uidx = window.apiClient.userCache._users.findIndex(u => u.id === serverUser.id);
              if (uidx >= 0) window.apiClient.userCache._users[uidx] = serverUser;
              else window.apiClient.userCache._users.push(serverUser);
            }
            window.apiClient.userCache._loadedAt = Date.now();
          }
          App.handleRoute();
          Workflow.showMessage('Created', 'User created successfully.', 'success');
        } catch (e) {
          console.error('Failed to create user', e);
          this.users = this.users.filter(u => u.id !== optimisticId);
          if (this.users.length === 0) this._usersLoaded = false;
          this._skipNextListFetch = true;
          App.handleRoute();
          Workflow.showMessage('Error', e.message || 'Unable to create user.', 'error');
          return;
        }
      }
    } catch (e) {
      const detail = e.message || 'Unable to save user.';
      Workflow.showMessage('Save User', detail, 'error');
    }
  },

  // ============================================================
  // Audit Log
  // ============================================================
  renderAuditSection() {
    const wrapper = el('div');
    const canViewAllAudit = Auth.can('audit:view_all');

    // Jira Filter Toolbar & Active Filters State
    const activeFilters = {
      user: new Set(),
      client: new Set(),
      date: new Set()
    };

    if (!canViewAllAudit) {
      const u = Auth.user?.name;
      if (u) activeFilters.user.add(u);
    }

    const savedFilters = App.restoreFilters('audit');
    if (savedFilters && canViewAllAudit) {
      if (Array.isArray(savedFilters.user)) savedFilters.user.forEach(v => activeFilters.user.add(v));
      if (Array.isArray(savedFilters.client)) savedFilters.client.forEach(v => activeFilters.client.add(v));
      if (Array.isArray(savedFilters.date)) savedFilters.date.forEach(v => activeFilters.date.add(v));
    }

    const saveCurrentFilters = () => {
      App.saveFilters('audit', {
        user: Array.from(activeFilters.user),
        client: Array.from(activeFilters.client),
        date: Array.from(activeFilters.date)
      });
    };

    const getUserOptions = () => (window.apiClient.userCache._users || []).map(u => ({ value: u.name, label: u.name }));
    const getClientOptions = () => (window.apiClient.clientCache._clients || []).map(c => ({ value: c.name, label: c.name }));
    const getDueDateOptions = () => [
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Due Today', label: 'Due Today' },
      { value: 'Due This Week', label: 'Due This Week' },
      { value: 'Due This Month', label: 'Due This Month' },
      { value: 'Due Later', label: 'Due Later' }
    ];

    const categories = {
      user: { label: 'User', getOptions: getUserOptions },
      client: { label: 'Client', getOptions: getClientOptions },
      date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
    };

    let searchQuery = '';
    let currentSort = App.restoreSort('audit') || 'newest';

    const toolbarContainer = createJiraFilterToolbar({
      moduleName: 'audit',
      searchConfig: {
        placeholder: 'Search audit log...',
        onSearch: (q) => { searchQuery = q; triggerRefresh(); }
      },
      categories,
      activeFilters,
      onFilterChange: () => {
        saveCurrentFilters();
        triggerRefresh();
      },
      sortOptions: [
        { key: 'newest', label: 'Newest first' },
        { key: 'oldest', label: 'Oldest first' }
      ],
      currentSort,
      onSortChange: (newSort) => {
        currentSort = newSort;
        App.saveSort('audit', newSort);
        triggerRefresh();
      }
    });

    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });
    stickyContainer.appendChild(toolbarContainer);
    wrapper.appendChild(stickyContainer);

    const content = el('div', { class: 'page-content-section' });
    const tableContainer = el('div');
    content.appendChild(tableContainer);
    wrapper.appendChild(content);

    const triggerRefresh = async () => {
      await this.refreshAuditLog(tableContainer, activeFilters, searchQuery, currentSort);
    };

    triggerRefresh().catch(err => console.error('[Users.renderAuditLogSection] refresh failed', err));
    return wrapper;
  },

  async refreshAuditLog(container, activeFilters, searchQuery, sortOrder) {
    this.clearNode(container);

    let allLogs = [];
    try {
      const pageSize = 100;
      let offset = 0;
      while (true) {
        const res = await window.apiClient.admin.listAudit({ limit: pageSize, offset });
        const page = res?.data || [];
        allLogs = allLogs.concat(page);
        if (!res?.meta?.hasMore || page.length === 0) break;
        offset += pageSize;
      }
    } catch (err) {
      console.error('[Users.refreshAuditLog] failed to load audit log', err);
      container.appendChild(renderEmptyState('Unable to load audit log', null, { variant: 'zero-state' }));
      return;
    }

    const hasLogs = allLogs.length > 0;

    // Create a chronological map of logs to determine their creation order sequence number.
    const chronological = [...allLogs].sort((a, b) => new Date(a.timestamp || a.created_at || 0) - new Date(b.timestamp || b.created_at || 0));
    const logSequenceMap = new Map();
    chronological.forEach((l, i) => {
      if (l.id) logSequenceMap.set(l.id, i + 1);
    });

    let logs = allLogs.slice();

    if (activeFilters && activeFilters.user && activeFilters.user.size > 0) {
      logs = logs.filter(l => activeFilters.user.has(l.userName || (window.apiClient.userCache.getById(l.userId)?.name)));
    }
    if (activeFilters && activeFilters.client && activeFilters.client.size > 0) {
      logs = logs.filter(l => {
        if (!l.details) return false;
        const detailsLower = l.details.toLowerCase();
        return Array.from(activeFilters.client).some(clientName => detailsLower.includes(clientName.toLowerCase()));
      });
    }
    if (activeFilters && activeFilters.date && activeFilters.date.size > 0) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
      const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

      logs = logs.filter(l => {
        const dStr = (l.timestamp || '').slice(0, 10);
        if (!dStr) return false;
        if (activeFilters.date.has(`DATE:${dStr}`)) return true;
        let bucket = 'Due Later';
        if (dStr < todayStr) bucket = 'Overdue';
        else if (dStr === todayStr) bucket = 'Due Today';
        else if (dStr <= endOfWeekStr) bucket = 'Due This Week';
        else if (dStr <= endOfMonthStr) bucket = 'Due This Month';
        return activeFilters.date.has(bucket);
      });
    }

    // Text search filter
    if (searchQuery) {
      logs = logs.filter(l => {
        const hay = [
          l.action || '',
          l.details || '',
          l.userName || '',
        ].join(' ').toLowerCase();
        return hay.includes(searchQuery);
      });
    }

    // Sort order (defaults to newest)
    const sort = sortOrder || 'newest';
    if (sort === 'oldest') {
      logs.sort((a, b) => new Date(a.timestamp || a.created_at || 0) - new Date(b.timestamp || b.created_at || 0));
    } else {
      logs.sort((a, b) => new Date(b.timestamp || b.created_at || 0) - new Date(a.timestamp || a.created_at || 0));
    }

    const hasActiveFilters = (activeFilters && Object.values(activeFilters).some(s => s && s.size > 0)) || !!searchQuery;

    if (logs.length === 0) {
      if (hasActiveFilters && hasLogs) {
        container.appendChild(renderFilterEmptyState(
          'No audit log entries match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('audit'); App.handleRoute(); } }]
        ));
      } else {
        container.appendChild(renderEmptyState('No audit log entries found', null, { variant: 'zero-state' }));
      }
      return;
    }

    const actionClassMap = {
      // Specific audit action phrases first so they win over generic partials.
      login: 'jira-backlog-tag-action-login',
      logout: 'jira-backlog-tag-action-logout',
      'work request created': 'jira-backlog-tag-action-create',
      'task completed': 'jira-backlog-tag-action-approve',
      'invoice sent': 'jira-backlog-tag-action-info',
      'disbursement released': 'jira-backlog-tag-action-release',
      'document stored': 'jira-backlog-tag-action-info',
      'disbursement submitted': 'jira-backlog-tag-action-warning',
      // Generic partials
      create: 'jira-backlog-tag-action-create',
      add: 'jira-backlog-tag-action-create',
      update: 'jira-backlog-tag-action-update',
      edit: 'jira-backlog-tag-action-update',
      delete: 'jira-backlog-tag-action-delete',
      remove: 'jira-backlog-tag-action-delete',
      archive: 'jira-backlog-tag-action-archive',
      approve: 'jira-backlog-tag-action-approve',
      complete: 'jira-backlog-tag-action-approve',
      reject: 'jira-backlog-tag-action-reject',
      submit: 'jira-backlog-tag-action-warning',
      release: 'jira-backlog-tag-action-release',
      sent: 'jira-backlog-tag-action-info',
      stored: 'jira-backlog-tag-action-info'
    };

    const getActionClass = (action) => {
      if (!action) return '';
      // Normalize underscores to spaces so phrase mappings like
      // 'work request created' match 'WORK_REQUEST_CREATED'.
      const normalized = action.toLowerCase().replace(/_/g, ' ');
      const key = Object.keys(actionClassMap).find(k => normalized.includes(k));
      return key ? actionClassMap[key] : '';
    };

    const items = logs.map((l, idx) => {
      const user = window.apiClient.userCache.getById(l.userId);
      const userName = user ? user.name : (l.userName || l.userId);
      const initials = userName.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
      const avatarStyle = user?.avatarUrl ? `background-image:url('${escapeHtml(user.avatarUrl)}'); background-size:cover; background-position:center;` : '';
      const avatarContent = user?.avatarUrl ? '' : escapeHtml(initials);
      const avatarIcon = `<div class="backlog-avatar${user?.avatarUrl ? ' backlog-avatar--image' : ''}" style="${avatarStyle}">${avatarContent}</div>`;
      const ts = new Date(l.timestamp);

      const seqNum = (l.id && logSequenceMap.get(l.id)) || (idx + 1);
      return {
        id: l.id || idx,
        keyText: 'AUD-' + String(seqNum).padStart(2, '0'),
        name: l.details || '—',
        iconHtml: avatarIcon,
        tags: [
          { text: l.action || 'Activity', type: 'action', className: 'jira-backlog-tag-action ' + getActionClass(l.action) },
          { text: l.entity, type: 'entity', className: 'badge badge-' + (l.entity === 'ATA' ? 'ata' : 'lta') },
          { text: userName, type: 'client' },
          { text: formatDate(l.timestamp) + ' ' + ts.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), type: 'schedule' }
        ]
      };
    });

    const backlog = JiraBacklogList.render({
      title: 'Audit Log',
      subtitle: 'system activity and changes',
      items,
      emptyText: 'No audit log entries found',
      rowIdPrefix: 'AUD',
      countLabel: 'entry',
      bulkActions: [],
      selectable: false,
      columns: [
        { label: 'Action', width: '220px' },
        { label: 'Entity', width: '60px' },
        { label: 'User', width: '140px' },
        { label: 'Timestamp', width: '160px' }
      ]
    });

    container.appendChild(backlog);
  },

  // ============================================================
  // Pending Approvals Section (reference-image category layout)
  // ============================================================

  getPendingCategories() {
    const entity = Auth.activeEntity;
    const allPendingChanges = (this._cachedAllPending || []).filter(pc => PendingChanges.canApproveChange(pc));

    const entFilter = ent => {
      const uEnt = (ent || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(uEnt);
      return uEnt === entity.toUpperCase();
    };

    const workRequestCreation = [];
    const wrPhaseRouting = [];
    const billingToRelease = [];
    const disbursementToRelease = [];
    const transmittalSent = [];
    const taskCreation = [];

    allPendingChanges.forEach(pc => {
      const isNew = !pc.parentRecordId;
      const data = pc.proposedData || {};
      const submitter = window.apiClient.userCache.getById(pc.submittedBy);

      // Resolve the entity for the pending change
      let itemEntity = data.entity;
      if (pc.table === 'workRequestPhaseRouting') {
        const wr = window.apiClient.workRequestCache.getById(pc.parentRecordId);
        itemEntity = wr?.entity;
      }
      if (!itemEntity || itemEntity === 'ALL') {
        itemEntity = (entity === 'ALL') ? (Auth.user.entities[0] || 'ATA') : entity;
      }

      // Filter by the active entity selection
      if (!entFilter(itemEntity)) return;

      if (pc.table === 'workRequests') {
        workRequestCreation.push({
          type: 'change',
          kind: 'workRequestCreation',
          id: pc.id,
          recordId: data.id || pc.parentRecordId,
          title: data.title || 'Work Request',
          description: data.description || (isNew ? 'New work request awaiting approval' : 'Work request edit awaiting approval'),
          amount: null,
          submittedBy: pc.submittedBy,
          submitter,
          submittedAt: pc.submittedAt,
          entity: itemEntity,
          raw: pc
        });
      } else if (pc.table === 'workRequestPhaseRouting') {
        const wr = window.apiClient.workRequestCache.getById(pc.parentRecordId);
        wrPhaseRouting.push({
          type: 'change',
          kind: 'wrPhaseRouting',
          id: pc.id,
          recordId: pc.parentRecordId,
          title: wr ? wr.title : 'Work Request',
          description: `Request to route to ${data.status || 'next phase'}`,
          amount: null,
          submittedBy: pc.submittedBy,
          submitter,
          submittedAt: pc.submittedAt,
          entity: itemEntity,
          raw: pc
        });
      } else if (pc.table === 'invoices') {
        billingToRelease.push({
          type: 'change',
          kind: 'billingInvoiceCreation',
          id: pc.id,
          recordId: data.id || pc.parentRecordId,
          title: `Invoice: ${data.invoiceNumber || data.id || '—'}`,
          description: isNew ? 'New invoice awaiting approval' : 'Invoice edit awaiting approval',
          amount: data.total || null,
          submittedBy: pc.submittedBy,
          submitter,
          submittedAt: pc.submittedAt,
          entity: itemEntity,
          raw: pc
        });
      } else if (pc.table === 'disbursements') {
        disbursementToRelease.push({
          type: 'change',
          kind: 'disbursementCreation',
          id: pc.id,
          recordId: data.id || pc.parentRecordId,
          title: `Expense: ${data.category || '—'}`,
          description: isNew ? 'New expense awaiting approval' : 'Expense edit awaiting approval',
          amount: data.amount || null,
          submittedBy: pc.submittedBy,
          submitter,
          submittedAt: pc.submittedAt,
          entity: itemEntity,
          raw: pc
        });
      } else if (pc.table === 'transmittals') {
        transmittalSent.push({
          type: 'change',
          kind: 'transmittalSent',
          id: pc.id,
          recordId: data.id || pc.parentRecordId,
          title: `Transmittal: ${data.trackingNumber || data.transmittalNumber || data.id || '—'}`,
          description: isNew ? 'New transmittal awaiting approval' : 'Transmittal edit awaiting approval',
          amount: null,
          submittedBy: pc.submittedBy,
          submitter,
          submittedAt: pc.submittedAt,
          entity: itemEntity,
          raw: pc
        });
      } else if (pc.table === 'tasks') {
        const wrId = data.workRequestId;
        const wr = wrId ? window.apiClient.workRequestCache.getById(wrId) : null;
        taskCreation.push({
          type: 'change',
          kind: 'taskCreation',
          id: pc.id,
          recordId: data.id || pc.parentRecordId,
          title: `Task: ${data.title || 'Untitled Task'}`,
          description: wr ? `For WR: ${wr.title}` : 'Task creation/edit awaiting approval',
          amount: null,
          submittedBy: pc.submittedBy,
          submitter,
          submittedAt: pc.submittedAt,
          entity: itemEntity,
          raw: pc
        });
      }
    });

    // Record-type pending release requests (disbursement, billing, transmittal)
    // are now handled through their respective resource APIs / operations requests;
    // only structural pending-approval changes remain in this list.

    return {
      workRequestCreation,
      wrPhaseRouting,
      billingToRelease,
      disbursementToRelease,
      transmittalSent,
      taskCreation
    };
  },

  async renderPendingSection() {
    const wrapper = el('div');

    if (this.pendingDetailId) {
      wrapper.appendChild(await this.renderPendingDetail(this.pendingDetailId));
      return wrapper;
    }

    const categories = this.getPendingCategories();
    const totalPending = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);

    const categoryDefs = {
      workRequestCreation: { label: 'Work Request Creation', keyPrefix: 'WR' },
      wrPhaseRouting: { label: 'WR Phase Routing', keyPrefix: 'ROUTE' },
      billingToRelease: { label: 'Billing to Release', keyPrefix: 'BIL' },
      disbursementToRelease: { label: 'Disbursement to Release', keyPrefix: 'EXP' },
      transmittalSent: { label: 'Mark Transmittal as Sent', keyPrefix: 'TX' },
      taskCreation: { label: 'Task Creation', keyPrefix: 'TSK' }
    };

    if (totalPending === 0) {
      wrapper.appendChild(renderEmptyState('No pending approvals', null, { variant: 'zero-state' }));
      return wrapper;
    }

    const self = this;

    // Category filter pills (reference-image layout)
    wrapper.appendChild(this.renderPendingPills(categories, categoryDefs, totalPending));

    // Render each non-empty category as its own card
    Object.keys(categoryDefs).forEach(key => {
      if (self.pendingCategory !== 'all' && self.pendingCategory !== key) return;
      const items = categories[key];
      if (!items || items.length === 0) return;
      const def = categoryDefs[key];

      const card = el('div', { class: 'approval-category-card' });

      // Category header with Approve All
      const header = el('div', { class: 'approval-category-header' });
      const title = el('div', { class: 'approval-category-title' });
      title.appendChild(el('span', { text: def.label }));
      title.appendChild(el('span', { class: 'count', text: items.length + ' pending' }));
      header.appendChild(title);

      const approveAllBtn = el('button', { class: 'approve-all-btn' });
      approveAllBtn.innerHTML = BoardCardIcons.checkCircle + ' Approve All';
      approveAllBtn.addEventListener('click', () => {
        Workflow.showConfirm('Approve All', `Approve all ${items.length} items in ${def.label}?`, () => {
          self.approveAll(key);
        }, 'success');
      });
      header.appendChild(approveAllBtn);
      card.appendChild(header);

      // Items list
      const list = el('div', { class: 'approval-items-list' });
      items.forEach((item, idx) => {
        list.appendChild(self.renderPendingApprovalItem(item, idx + 1, def.keyPrefix));
      });
      card.appendChild(list);

      wrapper.appendChild(card);
    });

    return wrapper;
  },

  renderPendingPills(categories, categoryDefs, totalPending) {
    const pillsWrap = el('div', { class: 'approval-filter-pills' });

    const addPill = (key, label, count, isActive, disabled) => {
      const btn = el('button', {
        class: 'approval-filter-pill' + (isActive ? ' active' : '') + (disabled ? ' disabled' : ''),
        title: label,
        disabled: disabled ? true : false
      });
      btn.appendChild(document.createTextNode(label));
      if (count !== undefined) {
        const badge = el('span', { class: 'approval-filter-pill-count', text: String(count) });
        btn.appendChild(document.createTextNode(' '));
        btn.appendChild(badge);
      }
      if (!disabled) {
        btn.addEventListener('click', () => {
          this.pendingCategory = key;
          sessionStorage.setItem('admin_pending_category', key);
          this.pendingDetailId = null;
          App.handleRoute();
        });
      }
      pillsWrap.appendChild(btn);
    };

    addPill('all', 'All', totalPending, this.pendingCategory === 'all', false);

    Object.keys(categoryDefs).forEach(key => {
      const items = categories[key] || [];
      if (items.length === 0) return;
      addPill(key, categoryDefs[key].label, items.length, this.pendingCategory === key, false);
    });

    return pillsWrap;
  },

  renderPendingApprovalItem(item, index, keyPrefix) {
    const submitter = item.submitter;
    const initials = submitter ? getInitials(submitter.name) : getInitials('System');
    const roleLabel = submitter ? `${submitter.role} ${item.entity || Auth.activeEntity || ''}` : 'System';
    const avatarColor = submitter ? groupColor(submitter.name) : '#94a3b8';

    const key = keyPrefix + '-' + String(index).padStart(3, '0');

    const row = el('div', { class: 'approval-item', style: 'cursor: pointer;' });
    row.addEventListener('click', () => {
      location.hash = `#admin/pending/${item.id}`;
    });

    // Status icon
    const icon = el('div', { class: 'approval-item-icon' });
    icon.innerHTML = BoardCardIcons.clock;
    row.appendChild(icon);

    // Body
    const body = el('div', { class: 'approval-item-body' });
    body.appendChild(el('div', { class: 'approval-item-key', text: key }));
    body.appendChild(el('div', { class: 'approval-item-title', text: item.title }));
    if (item.description) {
      body.appendChild(el('div', { class: 'approval-item-desc', text: item.description }));
    }

    const meta = el('div', { class: 'approval-item-meta' });
    if (submitter) {
      const badge = el('span', { class: 'submitter-badge' });
      const avatar = el('span', { class: 'submitter-avatar', title: submitter.name });
      avatar.textContent = initials;
      avatar.style.backgroundColor = avatarColor;
      if (submitter.avatarUrl) {
        avatar.style.backgroundImage = `url('${submitter.avatarUrl}')`;
        avatar.textContent = '';
      }
      badge.appendChild(avatar);
      badge.appendChild(el('span', { class: 'submitter-role', text: roleLabel }));
      meta.appendChild(badge);
    }

    const dateEl = el('span', { class: 'approval-item-date' });
    dateEl.innerHTML = BoardCardIcons.calendar + '<span>' + formatDate(item.submittedAt) + '</span>';
    meta.appendChild(dateEl);

    if (item.amount !== null && item.amount !== undefined) {
      meta.appendChild(el('span', { class: 'approval-item-amount', text: formatPHP(item.amount) }));
    }
    body.appendChild(meta);
    row.appendChild(body);

    // Actions reveal on hover
    const actions = el('div', { class: 'approval-item-actions' });
    const rejectBtn = el('button', { class: 'btn btn-sm btn-reject', title: 'Reject' });
    rejectBtn.innerHTML = BoardCardIcons.reject + ' Reject';
    rejectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.rejectPendingItem(item);
    });

    const approveBtn = el('button', { class: 'btn btn-sm btn-approve', title: 'Approve' });
    approveBtn.innerHTML = BoardCardIcons.checkCircle + ' Approve';
    approveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.approvePendingItem(item);
    });

    actions.appendChild(rejectBtn);
    actions.appendChild(approveBtn);
    row.appendChild(actions);

    return row;
  },

  approvePendingItem(item) {
    if (item.kind === 'wrPhaseRouting') {
      Workflow.showConfirm('Confirm Routing', `Approve routing for ${item.title} to ${item.raw?.proposedData?.status || 'next phase'}?`, async () => {
        const nextPhase = item.raw?.proposedData?.status;
        if (nextPhase) {
          try {
            await window.apiClient.workRequests.update(item.recordId, { status: nextPhase });
          } catch (e) {
            Workflow.showMessage('Approve Routing', e.message || 'Unable to update work request status.', 'error');
            return;
          }
        }
        try {
          await PendingChanges.delete(item.id);
        } catch (e) {
          console.error('[Users.approvePendingItem] failed to withdraw routing pending change', e);
        }
        if (typeof triggerSyncReload === 'function') {
          await triggerSyncReload(null, { title: 'Approve Routing', message: 'Routing approved successfully.' });
        } else {
          App.handleRoute();
        }
      }, 'success');
      return;
    }
    if (item.type === 'change') {
      Workflow.showConfirm('Confirm Approval', `Approve ${item.title}?`, async () => {
        try {
          await PendingChanges.approve(item.id);
        } catch (e) {
          Workflow.showMessage('Approve Change', e.message || 'Unable to approve change.', 'error');
          return;
        }
        if (typeof triggerSyncReload === 'function') {
          await triggerSyncReload(null, { title: 'Approve Change', message: 'The change has been successfully approved.' });
        } else {
          App.handleRoute();
        }
      }, 'success');
    }
  },

  rejectPendingItem(item) {
    const reason = prompt('Enter rejection reason:');
    if (reason === null) return;

    if (item.type === 'change') {
      Workflow.showConfirm('Confirm Rejection', 'Are you sure you want to reject this change?', async () => {
        try {
          await PendingChanges.reject(item.id, reason);
        } catch (e) {
          Workflow.showMessage('Reject Change', e.message || 'Unable to reject change.', 'error');
          return;
        }
        if (typeof triggerSyncReload === 'function') {
          await triggerSyncReload(null, { title: 'Reject Change', message: 'The change has been rejected.', type: 'info' });
        } else {
          App.handleRoute();
        }
      }, 'danger');
    }
  },

  approveAll(categoryKey) {
    const categories = this.getPendingCategories();
    const items = categories[categoryKey] || [];
    if (items.length === 0) return;

    let processed = 0;
    items.forEach(item => {
      if (item.type === 'change') {
        PendingChanges.approve(item.id).catch(e => {
          console.error('[Users.approveAll] approve failed', e);
        });
        processed++;
      }
    });

    if (processed > 0) {
      setTimeout(async () => {
        if (typeof triggerSyncReload === 'function') {
          await triggerSyncReload(null, { title: 'Approve All', message: 'The changes have been approved.' });
        } else {
          App.handleRoute();
        }
      }, 150);
    } else {
      Workflow.showMessage('Approve All', 'Some items require individual review and cannot be bulk-approved.', 'warning');
    }
  },

  // Legacy board/table/list views kept for possible future toggles / backwards compatibility
  async renderPendingSectionLegacy() {
    const wrapper = el('div');

    if (this.pendingDetailId) {
      wrapper.appendChild(await this.renderPendingDetail(this.pendingDetailId));
      return wrapper;
    }

    let pendingChanges = (this._cachedAllPending || []);
    pendingChanges = pendingChanges.filter(pc => PendingChanges.canApproveChange(pc));

    if (pendingChanges.length === 0) {
      wrapper.appendChild(renderEmptyState('No pending approvals', null, { variant: 'zero-state' }));
      return wrapper;
    }

    const headerBar = el('div', { class: 'form-header-bar', style: 'margin-bottom: 20px;' });
    headerBar.appendChild(el('h2', { text: 'Pending Approvals Queue', style: 'margin: 0;' }));
    wrapper.appendChild(headerBar);

    // View Mode Toggle
    const viewMode = App.getPreferredViewMode('pendingApprovals') || 'board';
    const vmToggle = el('div', { class: 'view-mode-toggle', style: 'margin-bottom: var(--spacing-md);' });
    const vmTable = el('button', { html: ViewIcons.table + ' Table', class: viewMode === 'table' ? 'active' : '' });
    const vmBoard = el('button', { html: ViewIcons.board + ' Board', class: viewMode === 'board' ? 'active' : '' });
    const vmList = el('button', { html: ViewIcons.list + ' List', class: viewMode === 'list' ? 'active' : '' });
    vmTable.addEventListener('click', () => { App.setPreferredViewMode('pendingApprovals', 'table'); App.handleRoute(); });
    vmBoard.addEventListener('click', () => { App.setPreferredViewMode('pendingApprovals', 'board'); App.handleRoute(); });
    vmList.addEventListener('click', () => { App.setPreferredViewMode('pendingApprovals', 'list'); App.handleRoute(); });
    vmToggle.appendChild(vmTable);
    vmToggle.appendChild(vmBoard);
    vmToggle.appendChild(vmList);
    wrapper.appendChild(vmToggle);

    const contentContainer = el('div');
    wrapper.appendChild(contentContainer);

    const items = [
      ...pendingChanges.map(pc => {
        const typeStr = pc.parentRecordId ? 'Edit' : 'New';
        const data = pc.proposedData || {};
        let title = `${pc.table.charAt(0).toUpperCase() + pc.table.slice(1)}`;
        let subtitle = `Pending approval for structural change (${typeStr})`;
        let amount = null;
        
        if (pc.table === 'workRequests') {
          title = `Work Request: ${data.title}`;
        } else if (pc.table === 'invoices') {
          title = `Invoice: #${data.invoiceNumber || data.id}`;
          amount = data.total;
        } else if (pc.table === 'transmittals') {
          title = `Transmittal: #${data.transmittalNumber || data.id}`;
        } else if (pc.table === 'tasks') {
           const wrId = data.workRequestId;
           const wr = wrId ? window.apiClient.workRequestCache.getById(wrId) : null;
           title = `Task: ${data.title}`;
           subtitle = wr ? `For WR: ${wr.title}` : 'Pending task approval';
         } else if (pc.table === 'clients') {
          title = `Client: ${data.name}`;
        }
        
        return {
          type: 'change',
          id: pc.id,
          title,
          subtitle,
          amount,
          submittedBy: pc.submittedBy,
          submittedAt: pc.submittedAt,
          raw: pc
        };
      })
    ];

    // Sort by submittedAt descending
    items.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    if (viewMode === 'table') {
      this.renderTableView(contentContainer, items);
    } else if (viewMode === 'list') {
      this.renderListView(contentContainer, items);
    } else {
      this.renderBoardView(contentContainer, items);
    }

    return wrapper;
  },

  renderBoardView(container, items) {
    if (items.length === 0) {
      container.appendChild(renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        title: 'No pending submissions',
        body: 'Submitted billing and expense requests will appear here for review.'
      }));
      return;
    }

    const self = this;
    let expNumber = 1;
    let billNumber = 1;

    KanbanBoard.render({
      container,
      items,
      getColumnKey: item => item.type === 'disbursement' ? 'expense' : 'billing',
      columns: [
        {
          key: 'expense',
          label: 'Expense Submissions',
          targetStatus: 'expense',
          color: '#f59e0b',
          emptyState: { variant: 'compact', title: 'No expense submissions', body: '' }
        },
        {
          key: 'billing',
          label: 'Billing Submissions',
          targetStatus: 'billing',
          color: '#3b82f6',
          emptyState: { variant: 'compact', title: 'No billing submissions', body: '' }
        }
      ],
      renderCard(item) {
        const submitter = window.apiClient.userCache.getById(item.submittedBy);
        const avatars = submitter ? [{ name: submitter.name, avatarUrl: submitter.avatarUrl }] : [];
        const isExpense = item.type === 'disbursement';
        const key = (isExpense ? 'EXP-' : 'BIL-') + (isExpense ? expNumber++ : billNumber++);
        const color = isExpense ? '#f59e0b' : '#3b82f6';

        const card = buildCompactBoardCard({
          key,
          statusColor: color,
          title: item.title,
          description: item.subtitle,
          date: item.submittedAt ? formatDate(item.submittedAt) : '',
          priority: isExpense ? 'Expense' : 'Billing',
          priorityClass: isExpense ? 'card-v2-priority-medium' : 'card-v2-priority-normal',
          avatars,
          onClick: () => {
            if (isExpense) {
              location.hash = '#disbursement/detail/' + item.id;
            } else {
              self.pendingDetailId = item.id;
              App.handleRoute();
            }
          }
        });

        const footerRight = card.querySelector('.card-v2-footer-right');
        if (item.amount !== null && item.amount !== undefined) {
          footerRight.appendChild(el('div', { class: 'card-v2-footer-item', text: formatPHP(item.amount), style: 'font-weight:700;color:var(--color-text);' }));
        }
        return card;
      },
      cardMenuItems(item) {
        return [{
          label: 'View Details',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
          onClick: () => {
            if (item.type === 'disbursement') {
              location.hash = '#disbursement/detail/' + item.id;
            } else {
              self.pendingDetailId = item.id;
              App.handleRoute();
            }
          }
        }];
      },
      drag: { enabled: false }
    });
  },

  getTypeBadgeInfo(item) {
    if (item.type === 'disbursement') {
      return { text: 'Expense', className: 'badge-warning' };
    }
    
    const table = item.raw && item.raw.table;
    switch (table) {
      case 'tasks':
        return { text: 'Task', className: 'badge-recurring' };
      case 'workRequests':
        return { text: 'Work Request', className: 'badge-preprocessing' };
      case 'invoices':
        return { text: 'Invoice', className: 'badge-billing' };
      case 'transmittals':
        return { text: 'Transmittal', className: 'badge-neutral' };
      case 'clients':
        return { text: 'Client', className: 'badge-info' };
      default:
        return { text: 'Change', className: 'badge-neutral' };
    }
  },

  renderTableView(container, items) {
    const table = el('table', { class: 'data-table' });
    const thead = el('thead');
    const thr = el('tr');
    ['Type', 'Title / Description', 'Amount', 'Submitted By', 'Date', 'Actions'].forEach(h => thr.appendChild(el('th', { text: h })));
    thead.appendChild(thr);
    table.appendChild(thead);
    
    const tbody = el('tbody');
    items.forEach(item => {
      const submitter = window.apiClient.userCache.getById(item.submittedBy);
      const tr = el('tr', { style: 'cursor: pointer;' });
      tr.addEventListener('click', () => {
        if (item.type === 'disbursement') {
          location.hash = '#disbursement/detail/' + item.id;
        } else {
          this.pendingDetailId = item.id;
          App.handleRoute();
        }
      });
      
      // Type
      const tdType = el('td');
      const badgeInfo = this.getTypeBadgeInfo(item);
      tdType.appendChild(el('span', {
        class: `badge ${badgeInfo.className}`,
        text: badgeInfo.text,
        style: 'font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 2px 6px; border-radius: 12px; display: inline-block; min-width: 90px; text-align: center;'
      }));
      tr.appendChild(tdType);
      
      // Title / Description
      const tdTitle = el('td');
      tdTitle.appendChild(el('div', { text: item.title, style: 'font-weight: 600; color: var(--color-text);' }));
      tdTitle.appendChild(el('div', { text: item.subtitle, style: 'font-size: 0.75rem; color: var(--color-text-muted); margin-top: 2px;' }));
      tr.appendChild(tdTitle);
      
      // Amount
      const tdAmount = el('td', { text: item.amount !== null && item.amount !== undefined ? formatPHP(item.amount) : '—' });
      tr.appendChild(tdAmount);
      
      // Submitted By
      const tdUser = el('td', { text: submitter ? submitter.name : '—' });
      tr.appendChild(tdUser);
      
      // Date
      const tdDate = el('td', { text: formatDate(item.submittedAt) });
      tr.appendChild(tdDate);
      
      // Actions
      const tdAct = el('td');
      const reviewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Review' });
      tdAct.appendChild(reviewBtn);
      tr.appendChild(tdAct);
      
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  },

  renderListView(container, items) {
    const list = el('div', { class: 'list-view' });
    items.forEach(item => {
      const submitter = window.apiClient.userCache.getById(item.submittedBy);
      const row = el('div', { class: 'list-item', style: 'cursor: pointer;' });
      row.addEventListener('click', () => {
        if (item.type === 'disbursement') {
          location.hash = '#disbursement/detail/' + item.id;
        } else {
          this.pendingDetailId = item.id;
          App.handleRoute();
        }
      });
      
      const badgeInfo = this.getTypeBadgeInfo(item);
      
      const leftPart = el('div', { style: 'display: flex; align-items: center; gap: 12px;' });
      leftPart.appendChild(el('span', {
        class: `badge ${badgeInfo.className}`,
        text: badgeInfo.text,
        style: 'font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 2px 6px; border-radius: 12px; display: inline-block; min-width: 90px; text-align: center;'
      }));
      
      const textInfo = el('div');
      textInfo.appendChild(el('div', { class: 'list-item-title', text: item.title }));
      
      let metaText = `Submitted by ${submitter ? submitter.name : 'System'} on ${formatDate(item.submittedAt)}`;
      if (item.amount !== null && item.amount !== undefined) {
        metaText += ` | Amount: ${formatPHP(item.amount)}`;
      }
      textInfo.appendChild(el('div', { class: 'list-item-meta', text: metaText }));
      leftPart.appendChild(textInfo);
      row.appendChild(leftPart);
      
      const rightWrap = el('div', { style: 'margin-left: auto;' });
      rightWrap.appendChild(el('button', { class: 'btn btn-secondary btn-sm', text: 'Review' }));
      row.appendChild(rightWrap);
      
      list.appendChild(row);
    });
    container.appendChild(list);
  },

  renderMyPendingSection() {
    const wrapper = el('div');
    const self = this;



    // Initialize view mode from localStorage
    this.myPendingViewMode = App.getPreferredViewMode('myPending');
    if (!this.myPendingViewMode || this.myPendingViewMode === 'list') this.myPendingViewMode = 'table';

    // Jira Filter Toolbar & Active Filters State
    const activeFilters = {
      category: new Set(),
      status: new Set(),
      date: new Set()
    };

    const savedFilters = App.restoreFilters('myPending');
    if (savedFilters) {
      if (Array.isArray(savedFilters.category)) savedFilters.category.forEach(v => activeFilters.category.add(v));
      else if (savedFilters.category) activeFilters.category.add(savedFilters.category);
      if (Array.isArray(savedFilters.status)) savedFilters.status.forEach(v => activeFilters.status.add(v));
      else if (savedFilters.status) activeFilters.status.add(savedFilters.status);
      if (Array.isArray(savedFilters.date)) savedFilters.date.forEach(v => activeFilters.date.add(v));
    }

    const saveCurrentFilters = () => {
      App.saveFilters('myPending', {
        category: Array.from(activeFilters.category),
        status: Array.from(activeFilters.status),
        date: Array.from(activeFilters.date)
      });
    };

    const getCategoryOptions = () => [
      { value: 'workRequests', label: 'Work Requests' },
      { value: 'invoices', label: 'Invoices' },
      { value: 'disbursements', label: 'Disbursements' },
      { value: 'transmittals', label: 'Transmittals' },
      { value: 'clients', label: 'Clients' },
      { value: 'tasks', label: 'Tasks' }
    ];

    const getStatusOptions = () => [
      { value: 'pending', label: 'Pending' },
      { value: 'rejected', label: 'Rejected' }
    ];

    const getDueDateOptions = () => [
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Due Today', label: 'Due Today' },
      { value: 'Due This Week', label: 'Due This Week' },
      { value: 'Due This Month', label: 'Due This Month' },
      { value: 'Due Later', label: 'Due Later' }
    ];

    const categories = {
      category: { label: 'Category', getOptions: getCategoryOptions },
      status: { label: 'Status', getOptions: getStatusOptions },
      date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
    };

    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });

    let searchQuery = '';
    const isPowerUser = Auth.user.role === 'Admin' || Auth.user.role === 'Manager';
    const toolbarConfig = {
      moduleName: 'myPending',
      searchConfig: {
        placeholder: 'Search pending...',
        onSearch: (q) => { searchQuery = q; updateFilters(); }
      },
      categories,
      activeFilters,
      onFilterChange: () => {
        saveCurrentFilters();
        updateFilters();
      }
    };
    if (isPowerUser) {
      toolbarConfig.viewMode = this.myPendingViewMode || 'table';
      toolbarConfig.onViewModeChange = (newMode) => {
        self.myPendingViewMode = newMode;
        App.setPreferredViewMode('myPending', newMode);
        saveCurrentFilters();
        updateFilters();
      };
    }
    const toolbarContainer = createJiraFilterToolbar(toolbarConfig);

    stickyContainer.appendChild(toolbarContainer);
    wrapper.appendChild(stickyContainer);

    const listContainer = el('div');
    wrapper.appendChild(listContainer);

    const updateFilters = () => self.refreshMyPendingList(listContainer, activeFilters, isPowerUser ? (self.myPendingViewMode || 'table') : 'table', searchQuery);
    updateFilters();

    return wrapper;
  },

  refreshMyPendingList(container, activeFilters, viewMode, searchQuery) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const self = this;

    let pending = (this._cachedMyPending || []);
    let rejected = (this._cachedMyRejected || []);

    // Combine all items into a unified list
    let allItems = [
      ...pending.map(pc => ({ ...pc, _displayStatus: 'pending' })),
      ...rejected.map(pc => ({ ...pc, _displayStatus: 'rejected' }))
    ];
    const hasItems = allItems.length > 0;

    // Apply category filter
    if (activeFilters.category && activeFilters.category.size > 0) {
      allItems = allItems.filter(pc => activeFilters.category.has(pc.table));
    }

    // Apply status filter
    if (activeFilters.status && activeFilters.status.size > 0) {
      allItems = allItems.filter(pc => activeFilters.status.has(pc.status));
    }

    // Apply date filter (bucket-based + custom date)
    if (activeFilters.date && activeFilters.date.size > 0) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
      const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

      allItems = allItems.filter(pc => {
        const dStr = (pc.submittedAt || '').slice(0, 10);
        if (!dStr) return false;
        if (activeFilters.date.has(`DATE:${dStr}`)) return true;
        let bucket = 'Due Later';
        if (dStr < todayStr) bucket = 'Overdue';
        else if (dStr === todayStr) bucket = 'Due Today';
        else if (dStr <= endOfWeekStr) bucket = 'Due This Week';
        else if (dStr <= endOfMonthStr) bucket = 'Due This Month';
        return activeFilters.date.has(bucket);
      });
    }

    // Text search filter
    if (searchQuery) {
      allItems = allItems.filter(pc => {
        const hay = [
          pc.table || '',
          pc.status || '',
          pc.proposedData?.name || pc.proposedData?.title || '',
          pc.submittedBy || '',
        ].join(' ').toLowerCase();
        return hay.includes(searchQuery);
      });
    }

    // Sort newest first
    allItems.sort((a, b) => new Date(b.submittedAt || '') - new Date(a.submittedAt || ''));

    const hasActiveFilters = Object.values(activeFilters).some(s => s && s.size > 0) || !!searchQuery;

    if (allItems.length === 0) {
      if (hasActiveFilters && hasItems) {
        container.appendChild(renderFilterEmptyState(
          'No submissions match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('myPending'); App.handleRoute(); } }]
        ));
      } else {
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
          title: 'No pending submissions',
          body: 'Your pending change requests will appear here once submitted.'
        }));
      }
      return;
    }

    if (viewMode === 'table') {
      this.renderMyPendingTableView(container, allItems);
    } else if (viewMode === 'board') {
      this.renderMyPendingBoardView(container, allItems);
    } else {
      this.renderMyPendingCompactListView(container, allItems);
    }
  },

  _pendingStatusBadge(status) {
    const map = {
      'pending': 'badge badge-warning',
      'rejected': 'badge badge-danger'
    };
    return el('span', { class: map[status] || 'badge', text: status.charAt(0).toUpperCase() + status.slice(1) });
  },

  _pendingCategoryLabel(table) {
    const map = {
      invoices: 'Invoices',
      disbursements: 'Disbursements',
      transmittals: 'Transmittals',
      clients: 'Clients',
      tasks: 'Tasks',
      workRequests: 'Work Requests'
    };
    return map[table] || table;
  },

  renderMyPendingTableView(container, items) {
    const self = this;
    const table = el('table', { class: 'data-table' });
    const thead = el('thead');
    const thr = el('tr');
    ['Category', 'Date', 'Type', 'Status', 'Rejection Reason', 'Actions'].forEach(h => thr.appendChild(el('th', { text: h })));
    thead.appendChild(thr);
    table.appendChild(thead);

    const tbody = el('tbody');
    items.forEach(pc => {
      const tr = el('tr', { style: 'cursor: pointer;' });
      tr.addEventListener('click', () => {
        location.hash = `#admin/myPending/${pc.id}`;
      });

      tr.appendChild(el('td', { text: self._pendingCategoryLabel(pc.table) }));
      tr.appendChild(el('td', { text: formatDate(pc.submittedAt) }));
      tr.appendChild(el('td', { text: pc.parentRecordId ? 'Edit' : 'New' }));

      const tdStatus = el('td');
      tdStatus.appendChild(self._pendingStatusBadge(pc.status));
      tr.appendChild(tdStatus);

      const tdReason = el('td', { 
        text: pc.status === 'rejected' ? (pc.rejectionReason || '—') : '—', 
        style: pc.status === 'rejected' ? 'color:var(--color-danger);font-weight:600;word-break:break-word;' : '' 
      });
      tr.appendChild(tdReason);

      const tdAct = el('td');
      const reviewBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Review', style: 'margin-right: 4px;' });
      reviewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.hash = `#admin/myPending/${pc.id}`;
      });
      tdAct.appendChild(reviewBtn);

      if (pc.status === 'pending') {
        const withdrawBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Withdraw' });
        withdrawBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          Workflow.showConfirm('Confirm Withdrawal', 'Are you sure you want to withdraw this pending submission?', async () => {
            try {
              await PendingChanges.delete(pc.id);
            } catch (err) {
              Workflow.showMessage('Withdraw Submission', err.message || 'Unable to withdraw submission.', 'error');
              return;
            }
            if (typeof triggerSyncReload === 'function') {
              const baseHash = location.hash.includes('/') ? location.hash.split('/')[0] : location.hash;
              await triggerSyncReload(baseHash, { title: 'Withdraw Change', message: 'Submission withdrawn.', type: 'info' });
            } else {
              if (location.hash.includes('/')) {
                location.hash = location.hash.split('/')[0];
              } else {
                App.handleRoute();
              }
            }
          }, 'danger');
        });
        tdAct.appendChild(withdrawBtn);
      } else if (pc.status === 'rejected') {
        const dismissBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Dismiss' });
        dismissBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          Workflow.showConfirm('Confirm Dismissal', 'Are you sure you want to dismiss and clear this rejected submission?', async () => {
            try {
              await PendingChanges.delete(pc.id);
            } catch (err) {
              Workflow.showMessage('Dismiss Submission', err.message || 'Unable to dismiss submission.', 'error');
              return;
            }
            if (typeof triggerSyncReload === 'function') {
              const baseHash = location.hash.includes('/') ? location.hash.split('/')[0] : location.hash;
              await triggerSyncReload(baseHash, { title: 'Dismiss Change', message: 'Submission dismissed.', type: 'info' });
            } else {
              if (location.hash.includes('/')) {
                location.hash = location.hash.split('/')[0];
              } else {
                App.handleRoute();
              }
            }
          }, 'danger');
        });
        tdAct.appendChild(dismissBtn);
      }

      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  },

  renderMyPendingBoardView(container, items) {
    const self = this;
    const statusColors = {
      'pending': '#f59e0b',
      'rejected': '#ef4444'
    };

    const columns = [
      { key: 'pending', label: 'Pending', targetStatus: 'pending', statuses: ['pending'], color: statusColors['pending'], emptyState: { variant: 'compact', title: 'No pending submissions', body: '' } },
      { key: 'rejected', label: 'Rejected', targetStatus: 'rejected', statuses: ['rejected'], color: statusColors['rejected'], emptyState: { variant: 'compact', title: 'No rejected submissions', body: '' } }
    ];

    let cardNumber = 1;
    const renderCard = (pc) => {
      const statusPriorityClass = pc.status === 'pending' ? 'card-v2-priority-medium' : 'card-v2-priority-critical';
      const progress = pc.status === 'pending' ? 50 : 0;
      return buildCompactBoardCard({
        key: 'SUB-' + cardNumber++,
        progress,
        statusColor: statusColors[pc.status] || '#cbd5e1',
        title: self._pendingCategoryLabel(pc.table),
        description: pc.parentRecordId ? 'Edit existing record' : 'New record submission',
        detail: (pc.status === 'rejected' && pc.rejectionReason) ? pc.rejectionReason : '',
        date: pc.submittedAt ? formatDate(pc.submittedAt) : '',
        priority: pc.status.charAt(0).toUpperCase() + pc.status.slice(1),
        priorityClass: statusPriorityClass,
        onClick: () => {
          self.pendingDetailId = pc.id;
          App.handleRoute();
        }
      });
    };

    const cardMenuItems = (pc) => {
      const menu = [{
        label: 'Review',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        onClick: () => { self.pendingDetailId = pc.id; App.handleRoute(); }
      }];
      if (pc.status === 'pending') {
        menu.push({
          label: 'Withdraw',
          className: 'danger',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
          onClick: () => Workflow.showConfirm('Confirm Withdrawal', 'Are you sure you want to withdraw this pending submission?', async () => {
            try {
              await PendingChanges.delete(pc.id);
            } catch (e) {
              Workflow.showMessage('Withdraw Submission', e.message || 'Unable to withdraw submission.', 'error');
              return;
            }
            if (typeof triggerSyncReload === 'function') {
              await triggerSyncReload(null, { title: 'Withdraw Change', message: 'Submission withdrawn.', type: 'info' });
            } else {
              App.handleRoute();
            }
          }, 'danger')
        });
      }
      if (pc.status === 'rejected') {
        menu.push({
          label: 'Dismiss',
          className: 'danger',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
          onClick: () => Workflow.showConfirm('Confirm Dismissal', 'Are you sure you want to dismiss and clear this rejected submission?', async () => {
            try {
              await PendingChanges.delete(pc.id);
            } catch (e) {
              Workflow.showMessage('Dismiss Submission', e.message || 'Unable to dismiss submission.', 'error');
              return;
            }
            if (typeof triggerSyncReload === 'function') {
              await triggerSyncReload(null, { title: 'Dismiss Change', message: 'Submission dismissed.', type: 'info' });
            } else {
              App.handleRoute();
            }
          }, 'danger')
        });
      }
      return menu;
    };

    KanbanBoard.render({
      container,
      items,
      columns: columns.map(col => ({
        key: col.key,
        label: col.label,
        targetStatus: col.targetStatus,
        color: col.color,
        emptyState: col.emptyState
      })),
      renderCard,
      cardMenuItems,
      drag: { enabled: false }
    });
  },

  renderMyPendingCompactListView(container, items) {
    const self = this;
    const list = el('div', { class: 'list-view' });
    items.forEach(pc => {
      const item = el('div', { class: 'list-item' });
      const left = el('div');
      left.appendChild(el('div', { class: 'list-item-title', text: self._pendingCategoryLabel(pc.table) }));
      const metaParts = [
        pc.parentRecordId ? 'Edit' : 'New',
        pc.status.charAt(0).toUpperCase() + pc.status.slice(1),
        pc.submittedAt ? formatDate(pc.submittedAt) : ''
      ].filter(Boolean);
      left.appendChild(el('div', { class: 'list-item-meta', text: metaParts.join(' • ') }));
      if (pc.status === 'rejected' && pc.rejectionReason) {
        left.appendChild(el('div', { class: 'list-item-meta', text: 'Reason: ' + pc.rejectionReason, style: 'color:var(--color-danger);' }));
      }
      item.appendChild(left);
      const rightActions = el('div', { style: 'display:flex;gap:4px;align-items:center;' });
      const reviewBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Review' });
      reviewBtn.addEventListener('click', () => { self.pendingDetailId = pc.id; App.handleRoute(); });
      rightActions.appendChild(reviewBtn);
      if (pc.status === 'pending') {
        const withdrawBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Withdraw' });
        withdrawBtn.addEventListener('click', () => {
          Workflow.showConfirm('Confirm Withdrawal', 'Are you sure you want to withdraw this pending submission?', async () => {
            try {
              await PendingChanges.delete(pc.id);
            } catch (e) {
              Workflow.showMessage('Withdraw Submission', e.message || 'Unable to withdraw submission.', 'error');
              return;
            }
            if (typeof triggerSyncReload === 'function') {
              await triggerSyncReload(null, { title: 'Withdraw Change', message: 'Submission withdrawn.', type: 'info' });
            } else {
              App.handleRoute();
            }
          }, 'danger');
        });
        rightActions.appendChild(withdrawBtn);
      }
      if (pc.status === 'rejected') {
        const dismissBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Dismiss' });
        dismissBtn.addEventListener('click', () => {
          Workflow.showConfirm('Confirm Dismissal', 'Are you sure you want to dismiss and clear this rejected submission?', async () => {
            try {
              await PendingChanges.delete(pc.id);
            } catch (e) {
              Workflow.showMessage('Dismiss Submission', e.message || 'Unable to dismiss submission.', 'error');
              return;
            }
            if (typeof triggerSyncReload === 'function') {
              await triggerSyncReload(null, { title: 'Dismiss Change', message: 'Submission dismissed.', type: 'info' });
            } else {
              App.handleRoute();
            }
          }, 'danger');
        });
        rightActions.appendChild(dismissBtn);
      }
      item.appendChild(rightActions);
      list.appendChild(item);
    });
    container.appendChild(list);
  },


  async renderPendingDetail(pendingId, isSidePeek = false, hideHeader = false) {
    const pc = await PendingChanges.getById(pendingId);
    if (!pc) {
      if (!isSidePeek) this.pendingDetailId = null;
      return renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        title: 'Pending change not found',
        body: 'The requested pending change could not be loaded.'
      });
    }

    const canApprove = PendingChanges.canApproveChange(pc);
    const isSubmitter = pc.submittedBy === Auth.user.id;

    const isFullPage = !isSidePeek && hideHeader;
    const wrapper = el('div', {
      class: isFullPage ? 'pending-detail-full-page' : '',
      style: isFullPage
        ? 'width: 100%; max-width: 100%; padding: var(--spacing-md);'
        : (isSidePeek ? 'padding: var(--spacing-xs);' : 'max-width: 800px; margin: 0 auto;')
    });

    if (!isSidePeek && !hideHeader) {
      // Inline header for tab/embedded views; full-page views use buildFormBreadcrumb.
      const header = el('div', { class: 'form-header-bar', style: 'border-bottom: 1px solid var(--color-border); padding-bottom: 16px; margin-bottom: 24px;' });
      header.appendChild(el('h2', { text: 'Review Pending Change Request', style: 'margin: 0; font-size: 1.25rem; font-weight: 600; color: var(--color-primary);' }));

      const backBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '← Back to List' });
      backBtn.addEventListener('click', () => {
        this.pendingDetailId = null;
        App.handleRoute();
      });
      header.appendChild(backBtn);
      wrapper.appendChild(header);
    }

    // SVGs for Notion Property Grid
    const Icons = {
      workRequest: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1.8 1.8"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1.8-1.8"/></svg>`,
      assignee: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
      coAssignees: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      priority: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
      dueDate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      predecessors: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8v8a6 6 0 0 0 12 0"/><circle cx="18" cy="8" r="3"/><circle cx="6" cy="8" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
      client: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      status: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      document: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      invoice: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 15h.01M12 15h.01M16 15h.01"/></svg>`,
      amount: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><circle cx="12" cy="15" r="2"/></svg>`,
      checklist: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`
    };

    function getInitials(name) {
      if (!name) return 'U';
      return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    }

    function createPropertyRow(label, iconSvg, valueNode) {
      return el('div', { class: 'notion-property-row' }, [
        el('span', { class: 'notion-property-label' }, [
          el('span', { html: iconSvg, style: 'display: flex; align-items: center;' }),
          label
        ]),
        el('span', { class: 'notion-property-value' }, [valueNode])
      ]);
    }

    // Submitter Info
    const submitter = window.apiClient.userCache.getById(pc.submittedBy);
    const submitterName = submitter ? submitter.name : pc.submittedBy;
    const submitterInitials = getInitials(submitterName);

    const singularName = {
      tasks: 'task',
      workRequests: 'work request',
      invoices: 'invoice',
      transmittals: 'transmittal',
      clients: 'client',
      disbursements: 'disbursement'
    }[pc.table] || pc.table;

    // Main Notion Card
    const reviewCard = el('div', { 
      class: isSidePeek ? '' : 'admin-review-card',
      style: isSidePeek ? 'display: flex; flex-direction: column; gap: var(--spacing-sm); padding: 0;' : ''
    });

    const avatarEl = el('div', { class: 'admin-review-avatar' });
    if (submitter && submitter.avatarUrl) {
      avatarEl.style.backgroundImage = `url('${submitter.avatarUrl}')`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
    } else {
      avatarEl.textContent = submitterInitials;
    }

    // 1. Card Header Row (Avatar, Meta Text, Status Badge)
    const cardHeader = el('div', { class: 'admin-review-card-header' }, [
      el('div', { class: 'admin-review-submitter-info' }, [
        avatarEl,
        el('div', { class: 'admin-review-meta-text' }, [
          el('strong', { text: submitterName }),
          ` proposed a new ${singularName} · ${formatDate(pc.submittedAt)}`
        ])
      ]),
      el('div', { class: 'admin-review-status-badge', text: 'Awaiting approval' })
    ]);
    reviewCard.appendChild(cardHeader);

    // 2. Title Section
    const proposed = pc.proposedData;
    let recordTitle = '';
    let titleIcon = '';

    if (pc.table === 'tasks') {
      recordTitle = proposed.title || '(Untitled)';
      titleIcon = Icons.checklist;
    } else if (pc.table === 'workRequests') {
      recordTitle = proposed.title || '(Untitled)';
      titleIcon = Icons.document;
    } else if (pc.table === 'invoices') {
      recordTitle = proposed.invoiceNumber || '(No Invoice Number)';
      titleIcon = Icons.invoice;
    } else if (pc.table === 'transmittals') {
      recordTitle = proposed.transmittalNumber || '(No Transmittal Number)';
      titleIcon = Icons.document;
    } else if (pc.table === 'clients') {
      recordTitle = proposed.name || '(No Client Name)';
      titleIcon = Icons.client;
    } else if (pc.table === 'disbursements') {
      recordTitle = proposed.voucherNumber || '(No Voucher Number)';
      titleIcon = Icons.amount;
    } else {
      recordTitle = proposed.title || proposed.name || proposed.invoiceNumber || proposed.voucherNumber || '(Untitled)';
      titleIcon = Icons.document;
    }

    const titleContainer = el('div', { class: 'notion-title-section' }, [
      el('div', { class: 'notion-title-icon', html: titleIcon }),
      el('h3', { class: 'notion-title-text', text: recordTitle })
    ]);
    reviewCard.appendChild(titleContainer);

    // 3. Validation / Warning Banner
    if (pc.table === 'tasks' && (proposed.title && (proposed.title.length <= 2 || proposed.title.toLowerCase() === 's'))) {
      const warningBox = el('div', { class: 'notion-warning-box' }, [
        el('span', { text: '⚠️', style: 'margin-right: 4px;' }),
        el('span', { text: 'Title looks incomplete — verify before approving.' })
      ]);
      reviewCard.appendChild(warningBox);
    }

    // 4. Notion Property Grid
    const propertyGrid = el('div', { class: 'notion-property-grid' });

    if (pc.table === 'tasks') {
      // Work Request
      const wr = proposed.workRequestId ? window.apiClient.workRequestCache.getById(proposed.workRequestId) : null;
      const wrVal = wr 
        ? el('a', { class: 'notion-property-value-link', href: `#operations/detail/${wr.id}`, text: wr.title || proposed.workRequestId })
        : el('span', { text: proposed.workRequestId || 'None' });
      propertyGrid.appendChild(createPropertyRow('Work request', Icons.workRequest, wrVal));

      // Assignee
      const assignee = proposed.assigneeId ? window.apiClient.userCache.getById(proposed.assigneeId) : null;
      const assigneeVal = assignee 
        ? el('span', { text: assignee.name })
        : el('span', { class: 'notion-property-value-warning', html: `⚠️ Not set` });
      propertyGrid.appendChild(createPropertyRow('Assignee', Icons.assignee, assigneeVal));

      // Co-assignees
      const coVal = (proposed.coAssignees && proposed.coAssignees.length > 0)
        ? el('span', { text: proposed.coAssignees.join(', ') })
        : el('span', { style: 'font-style: italic; color: var(--color-text-muted);', text: 'None' });
      propertyGrid.appendChild(createPropertyRow('Co-assignees', Icons.coAssignees, coVal));

      // Priority
      const priority = proposed.priority || 'Normal';
      let priorityClass = 'badge-info';
      if (priority === 'High' || priority === 'Urgent') priorityClass = 'badge-danger';
      else if (priority === 'Low') priorityClass = 'badge-muted';
      const priorityVal = el('span', { 
        class: `badge ${priorityClass}`, 
        text: priority,
        style: 'font-size: 11px; padding: 2px 8px; border-radius: 12px;'
      });
      propertyGrid.appendChild(createPropertyRow('Priority', Icons.priority, priorityVal));

      // Due date
      const dueVal = proposed.dueDate
        ? el('span', { text: formatDate(proposed.dueDate) })
        : el('span', { style: 'font-style: italic; color: var(--color-text-muted);', text: 'Not set' });
      propertyGrid.appendChild(createPropertyRow('Due date', Icons.dueDate, dueVal));

      // Predecessors
      const predVal = (proposed.predecessors && proposed.predecessors.length > 0)
        ? el('span', { text: proposed.predecessors.join(', ') })
        : el('span', { style: 'font-style: italic; color: var(--color-text-muted);', text: 'None' });
      propertyGrid.appendChild(createPropertyRow('Predecessors', Icons.predecessors, predVal));

    } else if (pc.table === 'workRequests') {
      const client = proposed.clientId ? window.apiClient.clientCache.getById(proposed.clientId) : null;
      propertyGrid.appendChild(createPropertyRow('Client', Icons.client, el('span', { text: client ? client.name : 'Not set' })));
      
      const statusVal = el('span', { class: 'badge badge-info', text: proposed.status || 'Draft' });
      propertyGrid.appendChild(createPropertyRow('Status', Icons.status, statusVal));

      const priority = proposed.priority || 'Normal';
      const priorityVal = el('span', { class: 'badge badge-info', text: priority });
      propertyGrid.appendChild(createPropertyRow('Priority', Icons.priority, priorityVal));

      const assignee = proposed.assigneeId ? window.apiClient.userCache.getById(proposed.assigneeId) : null;
      propertyGrid.appendChild(createPropertyRow('Assignee', Icons.assignee, el('span', { text: assignee ? assignee.name : 'Not set' })));

    } else if (pc.table === 'invoices') {
      const client = proposed.clientId ? window.apiClient.clientCache.getById(proposed.clientId) : null;
      propertyGrid.appendChild(createPropertyRow('Client', Icons.client, el('span', { text: client ? client.name : 'Not set' })));

      const wr = proposed.workRequestId ? window.apiClient.workRequestCache.getById(proposed.workRequestId) : null;
      propertyGrid.appendChild(createPropertyRow('Work request', Icons.workRequest, el('span', { text: wr ? wr.title : 'None' })));

      propertyGrid.appendChild(createPropertyRow('Issue date', Icons.dueDate, el('span', { text: formatDate(proposed.issueDate) })));
      propertyGrid.appendChild(createPropertyRow('Due date', Icons.dueDate, el('span', { text: formatDate(proposed.dueDate) })));
      propertyGrid.appendChild(createPropertyRow('Total amount', Icons.amount, el('span', { text: formatPHP(proposed.total), style: 'font-weight: 700;' })));

    } else if (pc.table === 'transmittals') {
      const client = proposed.clientId ? window.apiClient.clientCache.getById(proposed.clientId) : null;
      propertyGrid.appendChild(createPropertyRow('Client', Icons.client, el('span', { text: client ? client.name : 'Not set' })));

      const wr = proposed.workRequestId ? window.apiClient.workRequestCache.getById(proposed.workRequestId) : null;
      propertyGrid.appendChild(createPropertyRow('Work request', Icons.workRequest, el('span', { text: wr ? wr.title : 'None' })));

      propertyGrid.appendChild(createPropertyRow('Date', Icons.dueDate, el('span', { text: formatDate(proposed.date) })));
      propertyGrid.appendChild(createPropertyRow('Status', Icons.status, el('span', { class: 'badge badge-info', text: proposed.status || 'Draft' })));

    } else if (pc.table === 'clients') {
      propertyGrid.appendChild(createPropertyRow('TIN', Icons.document, el('span', { text: proposed.tin || 'None' })));
      propertyGrid.appendChild(createPropertyRow('RDO Code', Icons.dueDate, el('span', { text: proposed.rdoCode || 'None' })));
      propertyGrid.appendChild(createPropertyRow('Contact person', Icons.assignee, el('span', { text: proposed.contactPerson || 'None' })));
      propertyGrid.appendChild(createPropertyRow('Phone', Icons.document, el('span', { text: proposed.phone || 'None' })));
      propertyGrid.appendChild(createPropertyRow('Email', Icons.document, el('span', { text: proposed.email || 'None' })));
      propertyGrid.appendChild(createPropertyRow('Retainer status', Icons.status, el('span', { text: proposed.retainer ? 'Yes' : 'No' })));

    } else if (pc.table === 'disbursements') {
      const client = proposed.clientId ? window.apiClient.clientCache.getById(proposed.clientId) : null;
      propertyGrid.appendChild(createPropertyRow('Client', Icons.client, el('span', { text: client ? client.name : 'Not set' })));
      propertyGrid.appendChild(createPropertyRow('Amount', Icons.amount, el('span', { text: formatPHP(proposed.amount), style: 'font-weight: 700;' })));
      propertyGrid.appendChild(createPropertyRow('Payment method', Icons.document, el('span', { text: proposed.paymentMethod || 'None' })));
      propertyGrid.appendChild(createPropertyRow('Status', Icons.status, el('span', { class: 'badge badge-info', text: proposed.status || 'Draft' })));

    } else {
      for (const [k, v] of Object.entries(proposed)) {
        if (['id', 'createdAt', 'updatedAt', 'tasks', 'lineItems', 'checklist'].includes(k)) continue;
        const displayVal = typeof v === 'object' ? JSON.stringify(v) : String(v);
        const niceKey = k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        propertyGrid.appendChild(createPropertyRow(niceKey, Icons.document, el('span', { text: displayVal })));
      }
    }

    reviewCard.appendChild(propertyGrid);

    // 5. Checklist or Sub-items section
    let hasSubSection = false;
    const subSectionContainer = el('div', { class: 'notion-sub-section' });

    if (pc.table === 'tasks') {
      hasSubSection = true;
      const checklistCount = proposed.checklist ? proposed.checklist.length : 0;
      subSectionContainer.appendChild(el('div', { class: 'notion-section-divider' }));
      subSectionContainer.appendChild(el('div', { class: 'notion-sub-section-title' }, [
        el('span', { html: Icons.checklist }),
        `Checklist items proposed (${checklistCount})`
      ]));

      if (proposed.checklist && proposed.checklist.length > 0) {
        const list = el('div', { style: 'display: flex; flex-direction: column; gap: 8px; margin-top: 12px;' });
        proposed.checklist.forEach(item => {
          const checkRow = el('div', { style: 'display: flex; align-items: center; gap: 8px;' }, [
            el('input', { type: 'checkbox', disabled: true, checked: item.completed }),
            el('span', { text: item.text, style: 'font-size: 0.875rem; color: var(--color-text); font-style: normal;' })
          ]);
          list.appendChild(checkRow);
        });
        subSectionContainer.appendChild(list);
      } else {
        subSectionContainer.appendChild(el('div', { class: 'notion-sub-section-content', text: 'Staff did not add any checklist items.' }));
      }
    } else if (pc.table === 'invoices' && proposed.lineItems && proposed.lineItems.length > 0) {
      hasSubSection = true;
      subSectionContainer.appendChild(el('div', { class: 'notion-section-divider' }));
      subSectionContainer.appendChild(el('div', { class: 'notion-sub-section-title' }, [
        el('span', { html: Icons.document }),
        `Line Items`
      ]));

      const liTable = el('table', { class: 'data-table', style: 'width: 100%; font-size: 0.8125rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px;' });
      const liThead = el('thead');
      const liThr = el('tr');
      ['Type', 'Description', 'Amount'].forEach(h => liThr.appendChild(el('th', { text: h, style: 'text-align: left; padding: 8px;' })));
      liThead.appendChild(liThr);
      liTable.appendChild(liThead);

      const liTbody = el('tbody');
      proposed.lineItems.forEach(item => {
        const tr = el('tr');
        tr.appendChild(el('td', { text: item.type, style: 'padding: 8px;' }));
        tr.appendChild(el('td', { text: item.description, style: 'padding: 8px;' }));
        tr.appendChild(el('td', { text: formatPHP(item.amount), style: 'padding: 8px; font-weight: 600;' }));
        liTbody.appendChild(tr);
      });
      liTable.appendChild(liTbody);
      liTable.style.fontStyle = 'normal';
      subSectionContainer.appendChild(liTable);
    } else if (pc.table === 'workRequests' && proposed.tasks && proposed.tasks.length > 0) {
      hasSubSection = true;
      subSectionContainer.appendChild(el('div', { class: 'notion-section-divider' }));
      subSectionContainer.appendChild(el('div', { class: 'notion-sub-section-title' }, [
        el('span', { html: Icons.checklist }),
        `Proposed Tasks (${proposed.tasks.length})`
      ]));

      const list = el('div', { style: 'display: flex; flex-direction: column; gap: 8px; margin-top: 12px;' });
      proposed.tasks.forEach(t => {
        const taskRow = el('div', { style: 'display: flex; align-items: center; gap: 8px;' }, [
          el('span', { html: Icons.checklist, style: 'color: var(--color-text-muted); opacity: 0.6;' }),
          el('span', { text: t.title, style: 'font-size: 0.875rem; color: var(--color-text); font-style: normal; font-weight: 500;' })
        ]);
        list.appendChild(taskRow);
      });
      subSectionContainer.appendChild(list);
    }

    if (hasSubSection) {
      reviewCard.appendChild(subSectionContainer);
    }

    wrapper.appendChild(reviewCard);

    // 6. Actions Footer
    const actions = el('div', {
      class: isSidePeek ? 'side-pane-form-footer' : '',
      style: isSidePeek ? 'margin-top: 0;' : 'display: flex; gap: 12px; border-top: 1px solid var(--color-border); padding-top: 20px; margin-top: 24px;'
    });

    const handleCloseAndRoute = () => {
      this.pendingDetailId = null;
      if (location.hash.includes('/')) {
        location.hash = location.hash.split('/')[0];
      } else {
        App.handleRoute();
      }
    };

    const handleCloseReloadAndRoute = async (msgConfig) => {
      this.pendingDetailId = null;
      if (typeof triggerSyncReload === 'function') {
        const baseHash = location.hash.includes('/') ? location.hash.split('/')[0] : location.hash;
        await triggerSyncReload(baseHash, msgConfig);
      } else {
        handleCloseAndRoute();
      }
    };

    if (canApprove) {
      const approveBtn = el('button', { class: 'btn btn-success', text: 'Approve Change' });
      approveBtn.addEventListener('click', () => {
        Workflow.showConfirm('Confirm Approval', 'Are you sure you want to approve this change?', async () => {
          try {
            await PendingChanges.approve(pc.id);
            await handleCloseReloadAndRoute({ title: 'Approve Change', message: 'The request has been successfully approved.' });
          } catch (e) {
            Workflow.showMessage('Approve Change', e.message || 'Unable to approve change.', 'error');
          }
        }, 'success');
      });
      actions.appendChild(approveBtn);

      const rejectBtn = el('button', { class: 'btn btn-danger', text: 'Reject' });
      rejectBtn.addEventListener('click', async () => {
        const reason = prompt('Enter rejection reason:');
        if (reason !== null) {
          try {
            await PendingChanges.reject(pc.id, reason);
            await handleCloseReloadAndRoute({ title: 'Reject Change', message: 'The request has been rejected.', type: 'info' });
          } catch (e) {
            Workflow.showMessage('Reject Change', e.message || 'Unable to reject change.', 'error');
          }
        }
      });
      actions.appendChild(rejectBtn);
    } else if (isSubmitter && pc.status === 'pending') {
      const withdrawBtn = el('button', { class: 'btn btn-secondary', text: 'Withdraw Submission' });
      withdrawBtn.addEventListener('click', () => {
        Workflow.showConfirm('Confirm Withdrawal', 'Are you sure you want to withdraw this submission?', async () => {
          try {
            await PendingChanges.delete(pc.id);
            await handleCloseReloadAndRoute({ title: 'Withdraw Change', message: 'Submission withdrawn.', type: 'info' });
          } catch (e) {
            Workflow.showMessage('Withdraw Submission', e.message || 'Unable to withdraw submission.', 'error');
          }
        }, 'danger');
      });
      actions.appendChild(withdrawBtn);
    } else if (isSubmitter && pc.status === 'rejected') {
      const editResubmitBtn = el('button', { class: 'btn btn-warning', text: 'Edit & Resubmit' });
      editResubmitBtn.addEventListener('click', () => {
        PendingChanges.editingPendingId = pc.id;
        this.pendingDetailId = null;
        if (window.SidePaneInstance && window.SidePaneInstance.isOpen()) {
          window.SidePaneInstance.close({ silent: true });
        }

        if (pc.table === 'invoices') {
          location.hash = `#billing/form/${pc.proposedData.id}`;
        } else if (pc.table === 'disbursements') {
          location.hash = `#disbursement/form/${pc.proposedData.id}`;
        } else if (pc.table === 'transmittals') {
          location.hash = `#transmittal/form/${pc.proposedData.id}`;
        } else if (pc.table === 'clients') {
          location.hash = `#clients/form/${pc.proposedData.id}`;
        } else if (pc.table === 'workRequests') {
          location.hash = `#operations/form/${pc.proposedData.id}`;
        } else if (pc.table === 'tasks') {
          if (location.hash.includes('/')) {
            location.hash = location.hash.split('/')[0];
          } else {
            App.handleRoute();
          }
          PendingChanges.editingPendingId = pc.id;
          Workflow.showEditTaskModal(pc.proposedData.id, () => {
            App.handleRoute();
          });
        }
      });
      actions.appendChild(editResubmitBtn);

      const dismissBtn = el('button', { class: 'btn btn-danger', text: 'Dismiss Submission' });
      dismissBtn.addEventListener('click', () => {
        Workflow.showConfirm('Confirm Dismissal', 'Are you sure you want to dismiss and clear this rejected submission?', async () => {
          try {
            await PendingChanges.delete(pc.id);
            await handleCloseReloadAndRoute({ title: 'Dismiss Change', message: 'Submission dismissed.', type: 'info' });
          } catch (e) {
            Workflow.showMessage('Dismiss Submission', e.message || 'Unable to dismiss submission.', 'error');
          }
        }, 'danger');
      });
      actions.appendChild(dismissBtn);
    }

    if (!hideHeader) {
      wrapper.appendChild(actions);
    }
    return wrapper;
  },

  renderMyRequestsSection() {
    const wrapper = el('div');
    const self = this;

    // Initialize view mode from localStorage
    this.myRequestsViewMode = App.getPreferredViewMode('myRequests');
    if (!this.myRequestsViewMode || this.myRequestsViewMode === 'list') this.myRequestsViewMode = 'table';

    // Jira Filter Toolbar & Active Filters State
    const activeFilters = {
      category: new Set(),
      status: new Set(),
      date: new Set()
    };

    const savedFilters = App.restoreFilters('myRequests');
    if (savedFilters) {
      if (Array.isArray(savedFilters.category)) savedFilters.category.forEach(v => activeFilters.category.add(v));
      else if (savedFilters.category) activeFilters.category.add(savedFilters.category);
      if (Array.isArray(savedFilters.status)) savedFilters.status.forEach(v => activeFilters.status.add(v));
      else if (savedFilters.status) activeFilters.status.add(savedFilters.status);
      if (Array.isArray(savedFilters.date)) savedFilters.date.forEach(v => activeFilters.date.add(v));
    }

    const saveCurrentFilters = () => {
      App.saveFilters('myRequests', {
        category: Array.from(activeFilters.category),
        status: Array.from(activeFilters.status),
        date: Array.from(activeFilters.date)
      });
    };

    const getCategoryOptions = () => [
      { value: 'billing', label: 'Billing' },
      { value: 'disbursement', label: 'Disbursement' },
      { value: 'transmittal', label: 'Transmittal' }
    ];

    const getStatusOptions = () => [
      { value: 'pending', label: 'Pending' },
      { value: 'fulfilled', label: 'Fulfilled' },
      { value: 'rejected', label: 'Rejected' }
    ];

    const getDueDateOptions = () => [
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Due Today', label: 'Due Today' },
      { value: 'Due This Week', label: 'Due This Week' },
      { value: 'Due This Month', label: 'Due This Month' },
      { value: 'Due Later', label: 'Due Later' }
    ];

    const categories = {
      category: { label: 'Category', getOptions: getCategoryOptions },
      status: { label: 'Status', getOptions: getStatusOptions },
      date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
    };

    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });

    let searchQuery = '';
    const isPowerUser = Auth.user.role === 'Admin' || Auth.user.role === 'Manager';
    const toolbarConfig = {
      moduleName: 'myRequests',
      searchConfig: {
        placeholder: 'Search requests...',
        onSearch: (q) => { searchQuery = q; updateFilters(); }
      },
      categories,
      activeFilters,
      onFilterChange: () => {
        saveCurrentFilters();
        updateFilters();
      }
    };
    if (isPowerUser) {
      toolbarConfig.viewMode = this.myRequestsViewMode || 'table';
      toolbarConfig.onViewModeChange = (newMode) => {
        self.myRequestsViewMode = newMode;
        App.setPreferredViewMode('myRequests', newMode);
        saveCurrentFilters();
        updateFilters();
      };
    }
    const toolbarContainer = createJiraFilterToolbar(toolbarConfig);

    stickyContainer.appendChild(toolbarContainer);
    wrapper.appendChild(stickyContainer);

    const listContainer = el('div');
    wrapper.appendChild(listContainer);

    const updateFilters = async () => {
      await self.refreshMyRequestsList(listContainer, activeFilters, isPowerUser ? (self.myRequestsViewMode || 'table') : 'table', searchQuery);
    };
    updateFilters().catch(err => console.error('[Users.renderMyRequestsSection] refresh failed', err));

    return wrapper;
  },

  _requestStatusBadge(status) {
    const map = {
      'pending': 'badge badge-warning',
      'fulfilled': 'badge badge-success',
      'rejected': 'badge badge-danger'
    };
    return el('span', { class: map[status] || 'badge', text: status.charAt(0).toUpperCase() + status.slice(1) });
  },

  _requestTypeLabel(type) {
    const map = { billing: 'Billing', disbursement: 'Disbursement', transmittal: 'Transmittal' };
    return map[type] || type;
  },

  async refreshMyRequestsList(container, activeFilters, viewMode, searchQuery) {
    while (container.firstChild) container.removeChild(container.firstChild);

    let requests = [];
    const hasItems = await (async () => {
      try {
        const res = await window.apiClient.operationsRequests.list({ requestedBy: Auth.user?.id, limit: 100 });
        requests = (res?.data || []).map(r => this._normalizeOperationsRequest(r));
        return requests.length > 0;
      } catch (err) {
        console.error('[Users.refreshMyRequestsList] failed to load operations requests', err);
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
          title: 'Unable to load requests',
          body: 'Check your connection and try again.'
        }));
        return false;
      }
    })();

    // Apply category filter
    if (activeFilters.category && activeFilters.category.size > 0) {
      requests = requests.filter(r => activeFilters.category.has(r.type));
    }

    // Apply status filter
    if (activeFilters.status && activeFilters.status.size > 0) {
      requests = requests.filter(r => activeFilters.status.has(r.status));
    }

    // Apply date filter (bucket-based + custom date)
    if (activeFilters.date && activeFilters.date.size > 0) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
      const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

      requests = requests.filter(r => {
        const dStr = (r.requestedAt || '').slice(0, 10);
        if (!dStr) return false;
        if (activeFilters.date.has(`DATE:${dStr}`)) return true;
        let bucket = 'Due Later';
        if (dStr < todayStr) bucket = 'Overdue';
        else if (dStr === todayStr) bucket = 'Due Today';
        else if (dStr <= endOfWeekStr) bucket = 'Due This Week';
        else if (dStr <= endOfMonthStr) bucket = 'Due This Month';
        return activeFilters.date.has(bucket);
      });
    }

    // Text search filter
    if (searchQuery) {
      requests = requests.filter(r => {
        const hay = [
          r.type || '',
          r.status || '',
          r.description || r.reason || '',
        ].join(' ').toLowerCase();
        return hay.includes(searchQuery);
      });
    }

    // Sort newest first
    requests.sort((a, b) => new Date(b.requestedAt || '') - new Date(a.requestedAt || ''));

    const hasActiveFilters = Object.values(activeFilters).some(s => s && s.size > 0) || !!searchQuery;

    if (requests.length === 0) {
      if (hasActiveFilters && hasItems) {
        container.appendChild(renderFilterEmptyState(
          'No requests match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('myRequests'); App.handleRoute(); } }]
        ));
      } else {
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
          title: 'No requests submitted yet',
          body: 'Submit a departmental request in the Operations section.',
          actions: [
            {
              text: 'Go to Operations',
              onClick: () => { location.hash = '#operations'; }
            }
          ]
        }));
      }
      return;
    }

    if (viewMode === 'table') {
      this.renderMyRequestsTableView(container, requests);
    } else if (viewMode === 'board') {
      this.renderMyRequestsBoardView(container, requests);
    } else {
      this.renderMyRequestsCompactListView(container, requests);
    }
  },

  renderMyRequestsTableView(container, requests) {
    const self = this;
    const table = el('table', { class: 'data-table' });
    const thead = el('thead');
    const thr = el('tr');
    ['Request Type', 'Work Request', 'Client', 'Requested At', 'Status', 'Fulfill Info / Actions'].forEach(h => thr.appendChild(el('th', { text: h })));
    thead.appendChild(thr);
    table.appendChild(thead);

    const tbody = el('tbody');
    requests.forEach(r => {
      const tr = el('tr', { style: 'cursor: pointer;' });
      tr.addEventListener('click', () => {
        location.hash = `#admin/myRequests/${r.id}`;
      });

      tr.appendChild(el('td', { text: this._requestTypeLabel(r.type) }));

      const wr = window.apiClient.workRequestCache.getById(r.workRequestId);
      tr.appendChild(el('td', { text: wr ? wr.title : '—' }));

      const client = window.apiClient.clientCache.getById(r.clientId);
      tr.appendChild(el('td', { text: client ? client.name : '—' }));

      tr.appendChild(el('td', { text: formatDate(r.requestedAt) }));

      const tdSt = el('td');
      tdSt.appendChild(this._requestStatusBadge(r.status));
      tr.appendChild(tdSt);

      const tdAct = el('td');
      const viewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'View', style: 'margin-right: 8px;' });
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.hash = `#admin/myRequests/${r.id}`;
      });
      tdAct.appendChild(viewBtn);

      if (r.status === 'pending') {
        const cancelBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Cancel Request' });
        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          Workflow.showConfirm('Cancel Request', 'Are you sure you want to cancel this request?', async () => {
            try {
              await window.apiClient.operationsRequests.remove(r.id);
              Users.invalidateMyRequestsCount();
              window.apiClient.operationsRequests.invalidateCounts();
            } catch (e) {
              Workflow.showMessage('Cancel Request', e.message || 'Unable to cancel request.', 'error');
              return;
            }
            if (location.hash.includes('/')) {
              location.hash = location.hash.split('/')[0];
            } else {
              App.handleRoute();
            }
          }, 'danger');
        });
        tdAct.appendChild(cancelBtn);
      } else if (r.status === 'fulfilled') {
        const fulfiller = window.apiClient.userCache.getById(r.fulfilledBy);
        tdAct.appendChild(el('span', { text: `Fulfilled by ${fulfiller ? fulfiller.name : 'System'} on ${formatDate(r.fulfilledAt)}`, style: 'color: var(--color-text-muted); font-size: 0.8125rem; margin-left: 4px;' }));
      } else if (r.status === 'rejected') {
        tdAct.appendChild(el('span', { text: r.rejectionReason ? `Reason: ${r.rejectionReason}` : 'No reason provided', style: 'color: var(--color-danger); font-size: 0.8125rem; margin-left: 4px;' }));
      }
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  },

  renderMyRequestsBoardView(container, requests) {
    const self = this;
    const statusColors = {
      'pending': '#f59e0b',
      'fulfilled': '#10b981',
      'rejected': '#ef4444'
    };

    const columns = [
      { key: 'pending', label: 'Pending', targetStatus: 'pending', color: statusColors['pending'], emptyState: { variant: 'compact', title: 'No pending requests', body: '' } },
      { key: 'fulfilled', label: 'Fulfilled', targetStatus: 'fulfilled', color: statusColors['fulfilled'], emptyState: { variant: 'compact', title: 'No fulfilled requests', body: '' } },
      { key: 'rejected', label: 'Rejected', targetStatus: 'rejected', color: statusColors['rejected'], emptyState: { variant: 'compact', title: 'No rejected requests', body: '' } }
    ];

    let cardNumber = 1;
    const renderCard = (r) => {
      const wr = window.apiClient.workRequestCache.getById(r.workRequestId);
      const client = window.apiClient.clientCache.getById(r.clientId);
      const statusPriorityMap = {
        'pending': 'card-v2-priority-medium',
        'fulfilled': 'card-v2-priority-low',
        'rejected': 'card-v2-priority-critical'
      };
      const progressMap = { 'pending': 33, 'fulfilled': 100, 'rejected': 0 };

      let detail = '';
      if (r.status === 'fulfilled') {
        const fulfiller = window.apiClient.userCache.getById(r.fulfilledBy);
        detail = `Fulfilled by ${fulfiller ? fulfiller.name : 'System'}`;
      } else if (r.status === 'rejected' && r.rejectionReason) {
        detail = r.rejectionReason;
      }

      return buildCompactBoardCard({
        key: 'REQ-' + cardNumber++,
        progress: progressMap[r.status] || 0,
        statusColor: statusColors[r.status] || '#cbd5e1',
        title: self._requestTypeLabel(r.type),
        description: client ? client.name : '—',
        detail: (wr ? wr.title : '') + (detail ? ' • ' + detail : ''),
        date: r.requestedAt ? formatDate(r.requestedAt) : '',
        priority: r.status.charAt(0).toUpperCase() + r.status.slice(1),
        priorityClass: statusPriorityMap[r.status] || 'card-v2-priority-normal',
        onClick: () => {
          self.showRequestDetailsModal(r);
        }
      });
    };

    const cardMenuItems = (r) => {
      const menu = [
        {
          label: 'View Details',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
          onClick: () => { self.showRequestDetailsModal(r); }
        }
      ];
      if (r.status === 'pending') {
        menu.push({
          label: 'Cancel Request',
          className: 'danger',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
          onClick: () => Workflow.showConfirm('Cancel Request', 'Are you sure you want to cancel this request?', async () => {
            try {
              await window.apiClient.operationsRequests.remove(r.id);
              Users.invalidateMyRequestsCount();
              window.apiClient.operationsRequests.invalidateCounts();
            } catch (e) {
              Workflow.showMessage('Cancel Request', e.message || 'Unable to cancel request.', 'error');
              return;
            }
            App.handleRoute();
          }, 'danger')
        });
      }
      return menu;
    };

    KanbanBoard.render({
      container,
      items: requests,
      columns: columns.map(col => ({
        key: col.key,
        label: col.label,
        targetStatus: col.targetStatus,
        color: col.color,
        emptyState: col.emptyState
      })),
      renderCard,
      cardMenuItems,
      drag: { enabled: false }
    });
  },

  renderMyRequestsCompactListView(container, requests) {
    const self = this;
    const list = el('div', { class: 'list-view' });
    requests.forEach(r => {
      const item = el('div', { class: 'list-item' });
      const left = el('div');
      left.appendChild(el('div', { class: 'list-item-title', text: self._requestTypeLabel(r.type) }));
      const wr = window.apiClient.workRequestCache.getById(r.workRequestId);
      const client = window.apiClient.clientCache.getById(r.clientId);
      const metaParts = [
        client ? client.name : '',
        wr ? wr.title : '',
        r.status.charAt(0).toUpperCase() + r.status.slice(1),
        r.requestedAt ? formatDate(r.requestedAt) : ''
      ].filter(Boolean);
      left.appendChild(el('div', { class: 'list-item-meta', text: metaParts.join(' • ') }));
      if (r.status === 'fulfilled') {
        const fulfiller = window.apiClient.userCache.getById(r.fulfilledBy);
        left.appendChild(el('div', { class: 'list-item-meta', text: `Fulfilled by ${fulfiller ? fulfiller.name : 'System'} on ${formatDate(r.fulfilledAt)}`, style: 'color:var(--color-success);' }));
      }
      if (r.status === 'rejected' && r.rejectionReason) {
        left.appendChild(el('div', { class: 'list-item-meta', text: 'Reason: ' + r.rejectionReason, style: 'color:var(--color-danger);' }));
      }
      item.appendChild(left);
      const rightActions = el('div', { style: 'display:flex;gap:4px;align-items:center;' });
      const viewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'View' });
      viewBtn.addEventListener('click', () => {
        self.showRequestDetailsModal(r);
      });
      rightActions.appendChild(viewBtn);

      if (r.status === 'pending') {
        const cancelBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
          Workflow.showConfirm('Cancel Request', 'Are you sure you want to cancel this request?', async () => {
            try {
              await window.apiClient.operationsRequests.remove(r.id);
              Users.invalidateMyRequestsCount();
              window.apiClient.operationsRequests.invalidateCounts();
            } catch (e) {
              Workflow.showMessage('Cancel Request', e.message || 'Unable to cancel request.', 'error');
              return;
            }
            App.handleRoute();
          }, 'danger');
        });
        rightActions.appendChild(cancelBtn);
      }
      rightActions.appendChild(self._requestStatusBadge(r.status));
      item.appendChild(rightActions);
      list.appendChild(item);
    });
    container.appendChild(list);
  },

  showRequestDetailsModal(r) {
    location.hash = `#admin/myRequests/${r.id}`;
  },

  renderPendingRequestsSection() {
    const wrapper = el('div');
    const self = this;

    // Jira Filter Toolbar & Active Filters State
    const activeFilters = {
      category: new Set(),
      status: new Set(),
      date: new Set()
    };

    const savedFilters = App.restoreFilters('pendingRequests');
    if (savedFilters) {
      if (Array.isArray(savedFilters.category)) savedFilters.category.forEach(v => activeFilters.category.add(v));
      else if (savedFilters.category) activeFilters.category.add(savedFilters.category);
      if (Array.isArray(savedFilters.status)) savedFilters.status.forEach(v => activeFilters.status.add(v));
      else if (savedFilters.status) activeFilters.status.add(savedFilters.status);
      if (Array.isArray(savedFilters.date)) savedFilters.date.forEach(v => activeFilters.date.add(v));
    }

    const saveCurrentFilters = () => {
      App.saveFilters('pendingRequests', {
        category: Array.from(activeFilters.category),
        status: Array.from(activeFilters.status),
        date: Array.from(activeFilters.date)
      });
    };

    const getCategoryOptions = () => {
      const opts = [];
      const depts = Auth.effectiveDepartments();
      const isManagement = depts.includes('Management') || Auth.user?.role === 'Manager';
      if (depts.includes('Accounting') || isManagement) {
        opts.push({ value: 'billing', label: 'Billing' });
        opts.push({ value: 'disbursement', label: 'Disbursement' });
      }
      if (depts.includes('Documentation') || isManagement) {
        opts.push({ value: 'transmittal', label: 'Transmittal' });
      }
      return opts;
    };

    const getStatusOptions = () => [
      { value: 'pending', label: 'Pending' },
      { value: 'fulfilled', label: 'Fulfilled' },
      { value: 'rejected', label: 'Rejected' }
    ];

    const getDueDateOptions = () => [
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Due Today', label: 'Due Today' },
      { value: 'Due This Week', label: 'Due This Week' },
      { value: 'Due This Month', label: 'Due This Month' },
      { value: 'Due Later', label: 'Due Later' }
    ];

    const categories = {
      category: { label: 'Category', getOptions: getCategoryOptions },
      status: { label: 'Status', getOptions: getStatusOptions },
      date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
    };

    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });

    let searchQuery = '';
    const toolbarConfig = {
      moduleName: 'pendingRequests',
      searchConfig: {
        placeholder: 'Search requests...',
        onSearch: (q) => { searchQuery = q; updateFilters(); }
      },
      categories,
      activeFilters,
      onFilterChange: () => {
        saveCurrentFilters();
        updateFilters();
      }
    };
    const toolbarContainer = createJiraFilterToolbar(toolbarConfig);

    stickyContainer.appendChild(toolbarContainer);
    wrapper.appendChild(stickyContainer);

    const listContainer = el('div');
    wrapper.appendChild(listContainer);

    const updateFilters = async () => {
      await self.refreshPendingRequestsList(listContainer, activeFilters, 'table', searchQuery);
    };
    updateFilters().catch(err => console.error('[Users.renderPendingRequestsSection] refresh failed', err));

    return wrapper;
  },

  async refreshPendingRequestsList(container, activeFilters, viewMode, searchQuery) {
    while (container.firstChild) container.removeChild(container.firstChild);

    let requests = [];
    const hasItems = await (async () => {
      try {
        const departments = Auth.effectiveDepartments();
        const isAccounting = departments.includes('Accounting');
        const isDocumentation = departments.includes('Documentation');
        const isManagement = departments.includes('Management') || Auth.user?.role === 'Manager';

        const promises = [];
        if (isAccounting || isManagement) {
          promises.push(window.apiClient.operationsRequests.list({ type: 'billing', limit: 1000 }));
          promises.push(window.apiClient.operationsRequests.list({ type: 'disbursement', limit: 1000 }));
        }
        if (isDocumentation || isManagement) {
          promises.push(window.apiClient.operationsRequests.list({ type: 'transmittal', limit: 1000 }));
        }

        const results = await Promise.all(promises);
        requests = results.flatMap(res => res?.data || []).map(r => this._normalizeOperationsRequest(r));
        return requests.length > 0;
      } catch (err) {
        console.error('[Users.refreshPendingRequestsList] failed to load operations requests', err);
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
          title: 'Unable to load requests',
          body: 'Check your connection and try again.'
        }));
        return false;
      }
    })();

    // Apply category filter
    if (activeFilters.category && activeFilters.category.size > 0) {
      requests = requests.filter(r => activeFilters.category.has(r.type));
    }

    // Apply status filter
    if (activeFilters.status && activeFilters.status.size > 0) {
      requests = requests.filter(r => activeFilters.status.has(r.status));
    }

    // Apply date filter (bucket-based + custom date)
    if (activeFilters.date && activeFilters.date.size > 0) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
      const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

      requests = requests.filter(r => {
        const dStr = (r.requestedAt || '').slice(0, 10);
        if (!dStr) return false;
        if (activeFilters.date.has(`DATE:${dStr}`)) return true;
        let bucket = 'Due Later';
        if (dStr < todayStr) bucket = 'Overdue';
        else if (dStr === todayStr) bucket = 'Due Today';
        else if (dStr <= endOfWeekStr) bucket = 'Due This Week';
        else if (dStr <= endOfMonthStr) bucket = 'Due This Month';
        return activeFilters.date.has(bucket);
      });
    }

    // Text search filter
    if (searchQuery) {
      requests = requests.filter(r => {
        const hay = [
          r.type || '',
          r.status || '',
          r.description || r.reason || '',
        ].join(' ').toLowerCase();
        return hay.includes(searchQuery);
      });
    }

    // Sort newest first
    requests.sort((a, b) => new Date(b.requestedAt || '') - new Date(a.requestedAt || ''));

    const hasActiveFilters = Object.values(activeFilters).some(s => s && s.size > 0) || !!searchQuery;

    if (requests.length === 0) {
      if (hasActiveFilters && hasItems) {
        container.appendChild(renderFilterEmptyState(
          'No requests match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('pendingRequests'); App.handleRoute(); } }]
        ));
      } else {
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
          title: 'No requests received',
          body: 'Pending requests from other departments will appear here.'
        }));
      }
      return;
    }

    this.renderPendingRequestsTableView(container, requests);
  },

  renderPendingRequestsTableView(container, requests) {
    const table = el('table', { class: 'data-table' });
    const thead = el('thead');
    const thr = el('tr');
    ['Request Type', 'Work Request', 'Client', 'Submitted By', 'Requested At', 'Status', 'Actions'].forEach(h => thr.appendChild(el('th', { text: h })));
    thead.appendChild(thr);
    table.appendChild(thead);

    const tbody = el('tbody');
    requests.forEach(r => {
      const tr = el('tr', { style: 'cursor: pointer;' });
      tr.addEventListener('click', () => {
        location.hash = `#admin/pendingRequests/${r.id}`;
      });

      tr.appendChild(el('td', { text: this._requestTypeLabel(r.type) }));

      const wr = window.apiClient.workRequestCache.getById(r.workRequestId);
      tr.appendChild(el('td', { text: wr ? wr.title : '—' }));

      const client = window.apiClient.clientCache.getById(r.clientId);
      tr.appendChild(el('td', { text: client ? client.name : '—' }));

      const submitter = window.apiClient.userCache.getById(r.requestedBy);
      tr.appendChild(el('td', { text: submitter ? submitter.name : '—' }));

      tr.appendChild(el('td', { text: formatDate(r.requestedAt) }));

      const tdSt = el('td');
      tdSt.appendChild(this._requestStatusBadge(r.status));
      tr.appendChild(tdSt);

      const tdAct = el('td');
      const viewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'View', style: 'margin-right: 8px;' });
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.hash = `#admin/pendingRequests/${r.id}`;
      });
      tdAct.appendChild(viewBtn);

      if (r.status === 'pending') {
        const fulfillBtn = el('button', { class: 'btn btn-success btn-sm', text: 'Fulfill', style: 'margin-right: 8px;' });
        fulfillBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.fulfillRequest(r);
        });
        tdAct.appendChild(fulfillBtn);

        const rejectBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Reject' });
        rejectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.rejectRequest(r);
        });
        tdAct.appendChild(rejectBtn);
      } else if (r.status === 'fulfilled') {
        const fulfiller = window.apiClient.userCache.getById(r.fulfilledBy);
        tdAct.appendChild(el('span', { text: `Fulfilled by ${fulfiller ? fulfiller.name : 'System'}`, style: 'color: var(--success); font-size: 0.8125rem;' }));
      } else if (r.status === 'rejected') {
        tdAct.appendChild(el('span', { text: r.rejectionReason ? `Reason: ${r.rejectionReason}` : 'Rejected', style: 'color: var(--color-danger); font-size: 0.8125rem;' }));
      }

      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  },

  fulfillRequest(r) {
    if (r.type === 'billing') {
      if (typeof Billing !== 'undefined') {
        Billing.prefilledRequestId = r.id;
      }
      location.hash = '#billing/form/new';
    } else if (r.type === 'disbursement') {
      if (typeof Disbursement !== 'undefined') {
        Disbursement.prefilledRequestId = r.id;
      }
      location.hash = '#disbursement/form/new';
    } else if (r.type === 'transmittal') {
      if (typeof Transmittal !== 'undefined') {
        Transmittal.prefilledRequestId = r.id;
        Transmittal.prefilledWrId = r.workRequestId;
        Transmittal.prefilledClientId = r.clientId;
      }
      location.hash = '#transmittal/form/new';
    }
  },

  async rejectRequest(r) {
    const reason = prompt('Enter rejection reason:');
    if (reason === null) return;
    try {
      await window.apiClient.operationsRequests.update(r.id, {
        status: 'rejected',
        rejectionReason: reason || 'Rejected',
        fulfilledBy: Auth.user.id,
        fulfilledAt: new Date().toISOString()
      });
      this.invalidatePendingRequestsCount();
      if (window.SidePaneInstance) {
        window.SidePaneInstance.close();
      }
      App.handleRoute();
      Workflow.showMessage('Request Rejected', 'The request has been rejected.', 'success');
    } catch (e) {
      Workflow.showMessage('Reject Failed', e.message || 'Unable to reject request.', 'error');
    }
  }
};
