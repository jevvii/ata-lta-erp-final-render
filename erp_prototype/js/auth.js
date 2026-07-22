/**
 * Authentication, Session & RBAC
 * Login, logout, session persistence, role-based access control, entity switching.
 *
 * Roles:
 *   Admin         – unrestricted, always ['ATA','LTA']
 *                   Creates WRs directly; approves Manager WRs; approves all phase routing.
 *                   Disbursement: can create, edit, delete disbursements (file expenses);
 *                   responsible for approving disbursement creation and release.
 *                   Transmittal: can create, edit, delete transmittals; approves
 *                   transmittal status changes (sent/received).
 *   Manager       – Creates WRs (requires Admin approval); approves tasks added by staff;
 *                   view-only for clients; cannot route phases.
 *                   Billing: can view all invoices for assigned WRs; request invoices
 *                   from Accounting; mark as paid (pending Admin approval).
 *                   Cannot create or edit invoices directly.
 *                   Disbursement: can view file expenses for assigned WRs only; cannot
 *                   file an expense; can request a disbursement for assigned WRs;
 *                   can mark a disbursement as released (pending Admin approval).
 *                   Transmittal: can view transmittals for assigned WRs; cannot create;
 *                   can mark as sent/received (pending Admin approval).
 *   Accounting    – per-entity staff, either ['ATA'] or ['LTA'] (never both)
 *                   Can add tasks (pending Manager approval); view WR details.
 *                   Disbursement: can create (file expenses) and edit disbursements;
 *                   requires Admin approval to release; can view disbursements.
 *                   Transmittal: view-only.
 *   Operations    – per-entity staff, either ['ATA'] or ['LTA'] (never both)
 *                   Can add tasks (pending Manager approval); upload documents for tasks; view WR details.
 *                   Disbursement: can only request a disbursement from Accounting.
 *                   Transmittal: can request a transmittal from Documentation.
 *   Documentation – cross-entity staff, always ['ATA','LTA']
 *                   Can add tasks (pending Manager approval); view WR details.
 *                   Disbursement: view-only.
 *                   Transmittal: can create and edit transmittals freely; can view;
 *                   can mark as sent/received (pending Admin approval).
 */

const Auth = {
  user: null,
  activeEntity: null,

  /** All non-Admin, non-Manager roles (i.e. staff-level roles). */
  STAFF_ROLES: ['Accounting', 'Operations', 'Documentation'],

  /** Convenience: every valid role in the system. */
  ALL_ROLES: ['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation'],

  /**
   * Departments a user may be assigned to. Department assignment is the source
   * of RBAC: a user's effective permissions are the union of the permission
   * sets for every department they belong to.
   *
   * Restricted to the four operational departments that receive permissions.
   */
  DEPARTMENTS: ['Management', 'Accounting', 'Operations', 'Documentation'],

  /**
   * Permission set granted by each department. A user assigned to multiple
   * departments receives the union of those permission sets.
   */
  DEPARTMENT_PERMISSIONS: {
    'Management': ['clients:view','workflow:view','workflow:edit','workflow:task_add','workflow:task_approve','billing:view','billing:request','billing:mark_paid','disbursement:view','disbursement:request','disbursement:mark_released','dms:view','dms:edit','dms:delete','dms:handover','transmittal:view','transmittal:mark','transmittal:delete','bypass_review:tasks','approve_change:tasks'],
    'Accounting': ['clients:view','workflow:view','workflow:task_add','billing:view','billing:edit','disbursement:view','disbursement:create','disbursement:edit','dms:view','transmittal:view','approve_change:invoices','approve_change:disbursements'],
    'Operations': ['clients:view','workflow:view','workflow:task_add','workflow:task_upload','billing:view','billing:request','disbursement:view','disbursement:request','dms:view','transmittal:view','transmittal:request'],
    'Documentation': ['clients:view','workflow:view','workflow:task_add','billing:view','disbursement:view','dms:view','dms:edit','dms:delete','dms:handover','transmittal:view','transmittal:create','transmittal:edit','transmittal:mark']
  },

  updateSessionClasses(hasSession) {
    if (hasSession) {
      document.documentElement.classList.add('has-session');
      document.documentElement.classList.remove('no-session');
    } else {
      document.documentElement.classList.add('no-session');
      document.documentElement.classList.remove('has-session');
    }
  },

  // Session is stored in localStorage (not sessionStorage) so that forms opened via
  // "New tab" view mode are still authenticated when the new tab loads.
  _sessionKey: 'erp_session',
  _tokenKey: 'erp_access_token',

  async login(email, password) {
    try {
      const res = await window.apiClient.auth.signin({ email, password });
      const { accessToken, refreshToken } = res.data;
      localStorage.setItem(this._tokenKey, accessToken);
      try { localStorage.setItem('erp_refresh_token', refreshToken); } catch (e) {}

      const me = await window.apiClient.me.get();
      this.user = me.data;
      this.activeEntity = this.user.activeEntity || (this.user.entities.includes('ATA') ? 'ATA' : 'LTA');
      localStorage.setItem(this._sessionKey, JSON.stringify({ activeEntity: this.activeEntity }));
      this.updateSessionClasses(true);
      return true;
    } catch (e) {
      // Log the real error in dev so we can distinguish
      // wrong password, missing profile, network issues, etc.
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.error('[Auth.login] failed:', e);
      }
      return false;
    }
  },

  logout() {
    this.user = null;
    this.activeEntity = null;
    localStorage.removeItem(this._sessionKey);
    try {
      localStorage.removeItem(this._tokenKey);
      localStorage.removeItem('erp_refresh_token');
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('erp_filters_')) sessionStorage.removeItem(key);
      });
    } catch (e) {}
    this.updateSessionClasses(false);
  },

  async restoreSession() {
    const token = localStorage.getItem(this._tokenKey);
    if (!token) {
      this.updateSessionClasses(false);
      return false;
    }
    try {
      const me = await window.apiClient.me.get();
      this.user = me.data;
      const saved = JSON.parse(localStorage.getItem(this._sessionKey) || '{}');
      this.activeEntity = saved.activeEntity || this.user.activeEntity || (this.user.entities.includes('ATA') ? 'ATA' : 'LTA');
      this.updateSessionClasses(true);
      return true;
    } catch (e) {
      // Clear stale token; demo/local fallback removed.
      try { localStorage.removeItem(this._tokenKey); } catch (err) {}
      this.user = null;
      this.updateSessionClasses(false);
      return false;
    }
  },

  can(action, entity) {
    if (!this.user) return false;
    entity = (entity || this.activeEntity || '').toUpperCase();
    if (this.user.role === 'Admin') return true;
    if (!this.user.entities.includes(entity)) return false;

    // RBAC is driven entirely by department assignment. The effective
    // permission set is the union of the permission sets for each allowed
    // department the user belongs to.
    const granted = new Set();
    const allowedDepts = new Set(this.DEPARTMENTS);
    const departments = Array.isArray(this.user.departments) ? this.user.departments : [];
    const effectiveDepts = departments.filter(dept => allowedDepts.has(dept));
    if (this.user.role) {
      const legacyDept = this.user.role === 'Manager' ? 'Management' : this.user.role;
      if (allowedDepts.has(legacyDept) && this.DEPARTMENT_PERMISSIONS[legacyDept] && !effectiveDepts.includes(legacyDept)) {
        effectiveDepts.push(legacyDept);
      }
    }
    effectiveDepts.forEach(dept => {
      (this.DEPARTMENT_PERMISSIONS[dept] || []).forEach(p => granted.add(p));
    });

    if (granted.has(action)) return true;
    const parts = action.split(':');
    if (parts.length === 2 && granted.has(`${parts[0]}:*`)) return true;
    return false;
  },

  effectiveDepartments() {
    if (!this.user) return [];
    const allowedDepts = new Set(this.DEPARTMENTS);
    const departments = Array.isArray(this.user.departments) ? this.user.departments : [];
    const effective = departments.filter(dept => allowedDepts.has(dept));
    if (this.user.role) {
      const legacyDept = this.user.role === 'Manager' ? 'Management' : this.user.role;
      if (allowedDepts.has(legacyDept) && this.DEPARTMENT_PERMISSIONS[legacyDept] && !effective.includes(legacyDept)) {
        effective.push(legacyDept);
      }
    }
    return effective;
  },

  canBypassReview(table) {
    return this.can('bypass_review:' + table);
  },

  canApproveChange(table) {
    if (this.user?.role === 'Admin') return true;
    if ((this.user?.departments || []).includes('Accounting') || this.user?.role === 'Accounting') {
      if (table === 'invoices' || table === 'disbursements') return true;
    }
    return this.can('approve_change:' + table);
  },

  isManagerial() {
    const role = this.user?.role;
    const departments = this.user?.departments || [];
    return role === 'Admin' || role === 'Manager' || departments.includes('Management');
  },

  /** Returns true if the current user has a staff-level (non-managerial) role. */
  isStaff() {
    return !this.isManagerial();
  },

  isSelfApprover(recordUserId) {
    return this.user?.id === recordUserId;
  },

  canViewWr(wr) {
    if (!this.user) return false;
    if (this.user.role === 'Admin') return true;
    // Managerial users (Management department or legacy Manager role) can view
    // work requests they own or are directly involved in.
    if (this.isManagerial()) {
      return wr && (wr.submittedBy === this.user.id || wr.requestedBy === this.user.id);
    }
    // Staff-level users can see owned/assigned work requests.
    if (!wr) return false;
    if (wr.submittedBy === this.user.id || wr.requestedBy === this.user.id) return true;
    
    // Check tasks from the cached work request (workRequestCache always includes tasks).
    const tasks = wr.tasks || [];
    const isAssigned = tasks.some(t => {
      if (t.assigneeId === this.user.id || t.assignedTo === this.user.id) return true;
      if (t.assigneeName && t.assigneeName === this.user.name) return true;
      if ((t.coAssignees || []).includes(this.user.name)) return true;
      return (t.checklist || []).some(item => item.assigneeName && item.assigneeName === this.user.name);
    });
    return isAssigned;
  },

  /**
   * canViewWr variant that accepts a pre-built task map to avoid N+1 DB lookups.
   * taskMap: { [workRequestId]: Task[] }
   */
  canViewWrWithTasks(wr, taskMap) {
    if (!this.user) return false;
    if (this.user.role === 'Admin') return true;
    if (this.isManagerial()) {
      return wr && (wr.submittedBy === this.user.id || wr.requestedBy === this.user.id);
    }
    if (!wr) return false;
    if (wr.submittedBy === this.user.id || wr.requestedBy === this.user.id) return true;
    const tasks = wr.isPendingApproval ? (wr.tasks || []) : (taskMap[wr.id] || []);
    return tasks.some(t => {
      if (t.assigneeId === this.user.id || t.assignedTo === this.user.id) return true;
      if (t.assigneeName && t.assigneeName === this.user.name) return true;
      if ((t.coAssignees || []).includes(this.user.name)) return true;
      return (t.checklist || []).some(item => item.assigneeName && item.assigneeName === this.user.name);
    });
  },


  canViewDisbursement(d) {
    if (!this.user) return false;
    const departments = this.user.departments || [];
    if (this.user.role === 'Admin' || departments.includes('Accounting')) return true;
    // Resolve the linked work request from the API cache only.
    const wr = d.linkedWorkRequestId && window.apiClient?.workRequestCache
      ? window.apiClient.workRequestCache.getById(d.linkedWorkRequestId)
      : null;

    // Managerial users can see linked disbursements when they can view the work request.
    if (this.isManagerial()) {
      if (!d.linkedWorkRequestId) return false;
      return wr && this.canViewWr(wr);
    }
    // Staff users can see WR-linked disbursements if they can view the WR,
    // or non-linked disbursements they personally requested.
    if (d.linkedWorkRequestId) {
      return wr && this.canViewWr(wr);
    }
    return d.requestedBy === this.user.id;
  },

  switchEntity(entity) {
    const upper = entity.toUpperCase();
    if (upper === 'ALL' || this.user?.entities.includes(upper)) {
      this.activeEntity = upper;
      localStorage.setItem(this._sessionKey, JSON.stringify({ userId: this.user.id, activeEntity: upper }));
      if (window.apiClient) {
        if (window.apiClient.workRequestCache?.invalidate) window.apiClient.workRequestCache.invalidate();
        if (window.apiClient.clientCache?.invalidate) window.apiClient.clientCache.invalidate();
        if (window.apiClient.userCache?.invalidate) window.apiClient.userCache.invalidate();
      }
    }
  },
};
