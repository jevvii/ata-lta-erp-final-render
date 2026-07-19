/**
 * App Shell — Task 4
 * Hash router, navigation, module loader with placeholder stubs.
 */

const App = {
  currentModule: null,
  _routeId: 0,
  _lastNavTime: 0,
  _bundlePromises: {},

  /**
   * Load a route-specific JS bundle on demand. Each bundle is only injected
   * once; subsequent calls return the same promise. This keeps the initial
   * page weight low while preserving the global-variable module contract.
   */
  loadBundle(name) {
    if (this._bundlePromises[name]) return this._bundlePromises[name];
    const bundles = (typeof window !== 'undefined' && window.__ERP_BUNDLES__) || {};
    const url = bundles[name];
    if (!url) return Promise.resolve();
    const promise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load bundle ' + name));
      document.body.appendChild(s);
    });
    this._bundlePromises[name] = promise;
    return promise;
  },

  /**
   * Ensure the lazy bundle required by a route is loaded before the route
   * handler tries to use its module globals.
   */
  async ensureRouteBundle(baseHash) {
    const map = {
      '#billing': 'billing',
      '#disbursement': 'billing',
      '#transmittal': 'billing',
      '#reports': 'admin',
      '#admin': 'admin',
      '#profile': 'admin',
    };
    const bundle = map[baseHash];
    if (bundle) await this.loadBundle(bundle);
  },

  /**
   * Theme management: manual toggle with OS preference fallback.
   * Persists the user's choice in localStorage so it survives reloads.
   */
  initTheme() {
    if (this._themeInited) return;
    this._themeInited = true;

    const apply = () => {
      const stored = localStorage.getItem('erp_theme');
      let theme = stored;
      if (!theme && window.matchMedia) {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      this.applyTheme(theme || 'light');
    };

    apply();
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!localStorage.getItem('erp_theme')) apply();
      });
    }
  },

  applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    const moon = document.getElementById('theme-icon-moon');
    const sun = document.getElementById('theme-icon-sun');
    if (moon && sun) {
      moon.classList.toggle('hidden', isDark);
      sun.classList.toggle('hidden', !isDark);
    }
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('erp_theme', next);
    this.applyTheme(next);
  },

  setupThemeToggle() {
    if (this._themeToggleWired) return;
    this._themeToggleWired = true;
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.addEventListener('click', () => this.toggleTheme());
  },

  async init() {
    if (!await Auth.restoreSession()) return;
    this.initTheme();
    this.setupThemeToggle();
    this.renderShell();
    this.setupRouting();
    this.setupNavigation();
    this.setupResponsiveMenu();
    this.setupSidebarCollapse();
    this.setupUserMenu();
    this.setupLogout();
    
    // Default route is dashboard for all users
    const defaultRoute = '#dashboard';
    
    if (!location.hash || location.hash === '') {
       location.hash = defaultRoute;
    }
    
    this.handleRoute();
    this.updateSidebarNotifications();
    this.setupStickyTrayResize();


    // Close split button dropdown menus when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.split-btn-group')) {
        document.querySelectorAll('.split-btn-menu').forEach(menu => {
          menu.classList.add('hidden');
        });
      }
    });

    window.addEventListener('resize', () => this.updateStickyOffsets());
    window.addEventListener('scroll', () => this.updateStickyOffsets());
    window.addEventListener('load', () => this.updateStickyOffsets());
  },

  updateStickyTrayOffset() {
    const content = document.getElementById('content');
    if (!content) return;
    const tray = content.querySelector('.filters-bar, .task-view-toolbar');

    const setHeight = (el) => {
      const height = el ? el.getBoundingClientRect().height : 0;
      content.style.setProperty('--sticky-tray-height', `${height}px`);
    };

    if (typeof ResizeObserver !== 'undefined') {
      if (!this._trayObserver) {
        this._trayObserver = new ResizeObserver((entries) => {
          for (const entry of entries) setHeight(entry.target);
        });
      }
      if (this._trayTarget && this._trayTarget !== tray) {
        this._trayObserver.unobserve(this._trayTarget);
      }
      if (tray) {
        this._trayObserver.observe(tray);
        this._trayTarget = tray;
      } else {
        this._trayTarget = null;
      }
    }

    setHeight(tray);
  },

  setupStickyTrayResize() {
    let raf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.updateStickyTrayOffset());
    });
  },

  updateSidebarNotifications() {
    const entity = Auth.activeEntity;

    // Disbursement nav badge only surfaces work awaiting the assigned handler's final release.
    // Pending approvals and release requests are handled in the dedicated Admin > Pending Approvals page.
    const items = DB.getWhere('disbursements', d => d.entity === entity);
    let count = 0;
    items.forEach(d => {
      if (d.status === 'Approved' && d.paymentHandledBy === Auth.user.id) {
        count++;
      }
    });

    const navLink = document.querySelector('nav a[href="#disbursement"]');
    if (navLink) {
      let badge = navLink.querySelector('.nav-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'nav-badge';
          navLink.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
      } else if (badge) {
        badge.remove();
      }
    }

    // Admin nav badge: reflect pending approvals / pending submissions to draw attention.
    const adminNav = document.querySelector('nav a[href="#admin"]');
    if (adminNav) {
      const canManageUsers = Auth.can('users:view');
      let adminCount = 0;
      if (canManageUsers) {
        // For admins/managers-with-user-access: count all pending approvals.
        if (typeof Users !== 'undefined' && typeof Users.getPendingCategories === 'function') {
          const categories = Users.getPendingCategories();
          adminCount = Object.values(categories).reduce((sum, arr) => sum + (arr || []).length, 0);
        }
      } else {
        // For staff: count their own pending submissions.
        const pendingChanges = (typeof PendingChanges !== 'undefined' && typeof PendingChanges.getPendingForUser === 'function') ? PendingChanges.getPendingForUser(Auth.user.id) : [];
        const myReqs = (typeof DB !== 'undefined' && typeof DB.getWhere === 'function') ? DB.getWhere('operationsRequests', r => r.requestedBy === Auth.user.id && r.status === 'pending') : [];
        let approvalsCount = 0;
        if (Auth.isManagerial() && typeof Users !== 'undefined' && typeof Users.getPendingCategories === 'function') {
          const categories = Users.getPendingCategories();
          approvalsCount = Object.values(categories).reduce((sum, arr) => sum + (arr || []).length, 0);
        }
        adminCount = pendingChanges.length + myReqs.length + approvalsCount;
      }

      let adminBadge = adminNav.querySelector('.nav-badge');
      if (adminCount > 0) {
        if (!adminBadge) {
          adminBadge = document.createElement('span');
          adminBadge.className = 'nav-badge';
          adminNav.appendChild(adminBadge);
        }
        adminBadge.textContent = adminCount > 99 ? '99+' : adminCount;
      } else if (adminBadge) {
        adminBadge.remove();
      }
    }

    // Pending requests are centralized on the Admin page; no module-level nav badges needed.
  },

  renderShell() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('user-name').textContent = Auth.user.name;
    const avatar = document.getElementById('user-avatar');
    if (avatar) {
      avatar.textContent = '';
      if (Auth.user.avatarUrl) {
        avatar.style.backgroundImage = `url('${Auth.user.avatarUrl}')`;
      } else {
        avatar.style.backgroundImage = `url('https://ui-avatars.com/api/?name=${encodeURIComponent(Auth.user.name)}&background=2563eb&color=fff')`;
      }
    }
    this.renderEntitySwitcher();

    const adminNav = document.querySelector('nav a[href="#admin"]');
    const canManageUsers = Auth.can('users:view');
    if (adminNav) {
      const labelEl = adminNav.querySelector('.nav-link-text');
      if (Auth.user.role === 'Admin') {
        adminNav.parentElement.style.display = '';
        if (labelEl) labelEl.textContent = 'Admin';
      } else {
        // Manager and other staff roles: show as "My Submissions"
        adminNav.parentElement.style.display = '';
        if (labelEl) labelEl.textContent = 'My Submissions';
      }
    }

    // Hide Reports nav link for non-Admin users
    const reportsNav = document.querySelector('nav a[href="#reports"]');
    if (reportsNav) {
      const canViewReports = Auth.can('reports:view');
      reportsNav.parentElement.style.display = canViewReports ? '' : 'none';
    }

    // Hide Disbursement nav link for users without disbursement:view permission
    const disbNav = document.querySelector('nav a[href="#disbursement"]');
    if (disbNav) {
      const canViewDisbursement = Auth.can('disbursement:view');
      disbNav.parentElement.style.display = canViewDisbursement ? '' : 'none';
    }

    // Hide Transmittal nav link for users without any transmittal permissions
    const transmittalNav = document.querySelector('nav a[href="#transmittal"]');
    if (transmittalNav) {
      const canViewTransmittal = Auth.can('transmittal:view') || Auth.can('transmittal:request');
      transmittalNav.parentElement.style.display = canViewTransmittal ? '' : 'none';
    }
  },

  renderEntitySwitcher() {
    const sel = document.getElementById('entity-switcher');
    sel.innerHTML = '';
    
    if (Auth.user.entities.length > 1 && Auth.isManagerial()) {
      const opt = document.createElement('option');
      opt.value = 'ALL';
      opt.textContent = 'Consolidated View';
      if ('ALL' === Auth.activeEntity) opt.selected = true;
      sel.appendChild(opt);
    }
    
    Auth.user.entities.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e;
      opt.textContent = e === 'ATA' ? 'ATA Accounting' : 'LTA Accounting';
      if (e === Auth.activeEntity) opt.selected = true;
      sel.appendChild(opt);
    });
    
    sel.onchange = (ev) => {
      const newEntity = ev.target.value;
      Auth.switchEntity(newEntity);
      this.updateEntityBadge();

      // When switching into consolidated mode, reset persisted filters so stale
      // per-entity filters (client, status, assignee, etc.) don't hide records
      // from the other entity. The backend falls back to the user's first real
      // entity for non-report modules, so starting with a clean filter state is
      // the safest UX.
      if (newEntity === 'ALL') {
        try {
          Object.keys(sessionStorage).forEach((key) => {
            if (key.startsWith('erp_filters_') || key.startsWith('erp_group_') || key.startsWith('erp_sort_')) {
              sessionStorage.removeItem(key);
            }
          });
        } catch (e) { /* ignore storage errors */ }
      }

      // Clean up module states for any detail/form view
      if (typeof Workflow !== 'undefined') {
        Workflow.view = 'list';
        Workflow.detailWrId = null;
        Workflow.editingId = null;
      }
      if (typeof Billing !== 'undefined') {
        Billing.view = 'list';
        Billing.detailId = null;
      }
      if (typeof Disbursement !== 'undefined') {
        Disbursement.view = 'list';
        Disbursement.detailId = null;
      }
      if (typeof Transmittal !== 'undefined') {
        Transmittal.view = 'list';
        Transmittal.detailId = null;
      }
      if (typeof Clients !== 'undefined') {
        Clients.editingId = null;
      }

      // If the current route has subpaths (e.g. #billing/detail/123), reset to the base route (e.g. #billing)
      const rawHash = location.hash || '#dashboard';
      const baseHash = rawHash.split('?')[0].split('/')[0];
      if (location.hash !== baseHash) {
        location.hash = baseHash;
      }

      triggerSyncReload(baseHash);
    };
  },

  updateEntityBadge() {
    const badge = document.getElementById('entity-badge');
    if (!badge) return;
    badge.className = 'badge';

    if (Auth.activeEntity === 'ALL') {
      const rawHash = location.hash || '#dashboard';
      const baseHash = rawHash.split('?')[0].split('/')[0];
      // Reports and dashboard are the only modules that return true consolidated
      // data for ALL. Every other module falls back to the user's first real entity.
      const isConsolidatedRoute = ['#dashboard', '#reports'].includes(baseHash);
      if (isConsolidatedRoute) {
        badge.textContent = 'Consolidated';
        badge.classList.add('badge-all');
      } else {
        const firstRealEntity = (Auth.user?.entities || []).find((e) => e !== 'ALL') || '';
        badge.textContent = firstRealEntity ? `Viewing ${firstRealEntity}` : '';
        badge.classList.add('badge-neutral');
      }
      return;
    }

    badge.textContent = Auth.activeEntity || '';
    if (Auth.activeEntity === 'ATA') badge.classList.add('badge-ata');
    else if (Auth.activeEntity === 'LTA') badge.classList.add('badge-lta');
  },

  renderRouteSkeleton(routeName) {
    if (typeof Utils !== 'undefined' && typeof Utils.renderRouteSkeleton === 'function') {
      return Utils.renderRouteSkeleton(routeName);
    }
    return '<div class="route-loading-overlay"><div class="loading-spinner"></div></div>';
  },

  setupRouting() {
    window.addEventListener('hashchange', () => this.handleRoute());
  },

  setupNavigation() {
    document.querySelectorAll('nav a[data-module]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();

        // 100 ms debounce to avoid accidental rapid-fire nav clicks.
        const now = Date.now();
        if (now - this._lastNavTime < 100) return;
        this._lastNavTime = now;

        const href = link.getAttribute('href');
        // Reset module view to 'list' when clicking a nav link directly
        const moduleViewMap = {
          '#operations': () => { Workflow.view = 'list'; Workflow.detailWrId = null; Workflow.editingId = null; },
          '#billing': () => { Billing.view = 'list'; Billing.detailId = null; },
          '#disbursement': () => { Disbursement.view = 'list'; Disbursement.detailId = null; },
          '#transmittal': () => { if (typeof Transmittal !== 'undefined') { Transmittal.view = 'list'; Transmittal.detailId = null; } },
          '#admin': () => { if (typeof Users !== 'undefined') { Users.view = 'users'; Users.editingId = null; Users.pendingDetailId = null; } }
        };
        if (moduleViewMap[href]) moduleViewMap[href]();
        if (location.hash === href) {
          // Hash won't change, so hashchange won't fire — call handleRoute manually
          this.handleRoute();
        } else {
          location.hash = href;
        }
      });
    });
  },

  setupResponsiveMenu() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const headerActions = document.querySelector('.header-actions');
    if (!toggle || !sidebar) return;

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (headerActions) headerActions.classList.toggle('show');
    });

    document.querySelectorAll('nav a[data-module]').forEach(link => {
      link.addEventListener('click', () => {
        sidebar.classList.remove('open');
        if (headerActions) headerActions.classList.remove('show');
      });
    });
  },

  setupSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-collapse-btn');
    if (!sidebar || !btn) return;

    // Restore persisted state
    if (localStorage.getItem('erp_sidebar_collapsed') === 'true') {
      sidebar.classList.add('collapsed');
      btn.title = 'Expand sidebar';
    }

    btn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      btn.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      localStorage.setItem('erp_sidebar_collapsed', isCollapsed);
    });
  },

  setupUserMenu() {
    const chip = document.getElementById('user-chip');
    const toggle = document.getElementById('user-menu-toggle');
    const dropdown = document.getElementById('user-menu-dropdown');
    if (!toggle || !dropdown) return;

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (chip && !chip.contains(e.target) && !dropdown.classList.contains('hidden')) {
        dropdown.classList.add('hidden');
      }
    });

    // Profile link navigates via hash
    const profileLink = document.getElementById('profile-link');
    if (profileLink) {
      profileLink.addEventListener('click', (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        location.hash = '#profile';
      });
    }
  },

  setupLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        Auth.logout();
        document.getElementById('app-shell').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
        const form = document.getElementById('login-form');
        if (form) form.reset();
        const errorEl = document.getElementById('login-error');
        if (errorEl) errorEl.classList.add('hidden');
      });
    }
  },

  /**
   * Read the performance.measure entry for a completed route switch and hand
   * it to ErpTelemetry. Safe to call even when telemetry is unavailable.
   */
  _reportRouteTelemetry(routeId, baseHash, cached) {
    if (typeof window.ErpTelemetry !== 'undefined' && typeof window.ErpTelemetry.recordRouteSwitch === 'function') {
      const measure = performance.getEntriesByName('route-switch-' + routeId, 'measure')[0];
      if (measure) {
        window.ErpTelemetry.recordRouteSwitch(baseHash, measure.duration, cached);
      }
    }
  },

  async handleRoute() {
    const routeId = ++this._routeId;
    performance.mark('route-start-' + routeId);

    if (window.SidePaneInstance) window.SidePaneInstance.close();
    const rawHash = location.hash || '#dashboard';

    // Abort in-flight GET requests from the previous route so the dashboard N+1
    // fetches (and similar) can be cancelled cleanly.
    if (typeof window.apiClient !== 'undefined' && typeof window.apiClient.abortRequests === 'function') {
      window.apiClient.abortRequests('route-change');
    }

    // Clear editingPendingId when leaving form routes
    const hasFormInHash = rawHash.includes('/form/') || rawHash.includes('/templateForm/');
    if (!hasFormInHash && typeof PendingChanges !== 'undefined') {
      PendingChanges.editingPendingId = null;
    }
    const parts = rawHash.split('?');
    const pathParts = parts[0].split('/');
    const baseHash = pathParts[0];

    // Load the route-specific bundle on demand before the module is used.
    await this.ensureRouteBundle(baseHash);

    // Auto-update module view state from route detail/form paths
    // Only override module views when the URL explicitly specifies a sub-path (detail/form).
    // When there's no sub-path, only reset to 'list' if the current view is a URL-driven
    // view (detail/form) — this preserves internal module views like 'templates', 'archive',
    // 'aging', 'trash', 'report', 'templateForm' that buttons set before calling handleRoute().
    //
    // Note on full-page form routes:
    // #module/form/new and #module/form/:id are now implemented for operations, billing,
    // disbursement, transmittal, clients, and retainer templates. These routes render the
    // form inline in the main content area (PaneMode.FULL_PAGE behavior) and set the module
    // editing state so that module.render() can display the form directly.
    if (baseHash === '#operations') {
      if (pathParts[1] === 'detail' && pathParts[2]) {
        Workflow.view = 'detail';
        Workflow.detailWrId = pathParts[2];
      } else if (pathParts[1] === 'form') {
        Workflow.view = 'form';
        Workflow.editingId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
      } else if (pathParts[1] === 'templateForm') {
        Workflow.view = 'templateForm';
        Workflow.templateEditingId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
      } else if (pathParts[1] === 'addTask' && pathParts[2]) {
        Workflow.view = 'addTask';
        Workflow.addTaskWrId = pathParts[2];
      } else if (!Workflow.view || Workflow.view === 'detail' || Workflow.view === 'form' || Workflow.view === 'templateForm' || Workflow.view === 'addTask') {
        Workflow.view = 'list';
        Workflow.detailWrId = null;
        Workflow.editingId = null;
        Workflow.templateEditingId = null;
        Workflow.addTaskWrId = null;
      }
    } else if (baseHash === '#billing') {
      if (pathParts[1] === 'detail' && pathParts[2]) {
        Billing.view = 'detail';
        Billing.detailId = pathParts[2];
      } else if (pathParts[1] === 'form') {
        Billing.view = 'form';
        Billing.detailId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
      } else if (pathParts[1] === 'templateForm') {
        Billing.view = 'templateForm';
        Billing.templateEditingId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
      } else if (!Billing.view || Billing.view === 'detail' || Billing.view === 'form' || Billing.view === 'templateForm') {
        Billing.view = 'list';
        Billing.detailId = null;
        Billing.templateEditingId = null;
      }
    } else if (baseHash === '#disbursement') {
      if (pathParts[1] === 'detail' && pathParts[2]) {
        Disbursement.view = 'detail';
        Disbursement.detailId = pathParts[2];
      } else if (pathParts[1] === 'form') {
        Disbursement.view = 'form';
        Disbursement.detailId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
      } else if (pathParts[1] === 'templateForm') {
        Disbursement.view = 'templateForm';
        Disbursement.templateEditingId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
      } else if (!Disbursement.view || Disbursement.view === 'detail' || Disbursement.view === 'form' || Disbursement.view === 'templateForm') {
        Disbursement.view = 'list';
        Disbursement.detailId = null;
        Disbursement.templateEditingId = null;
      }
    } else if (baseHash === '#transmittal') {
      if (pathParts[1] === 'detail' && pathParts[2]) {
        Transmittal.view = 'detail';
        Transmittal.detailId = pathParts[2];
      } else if (pathParts[1] === 'form') {
        Transmittal.view = 'form';
        Transmittal.detailId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
      } else if (!Transmittal.view || Transmittal.view === 'detail' || Transmittal.view === 'form') {
        Transmittal.view = 'list';
        Transmittal.detailId = null;
      }
    } else if (baseHash === '#clients') {
      if (pathParts[1] === 'form') {
        Clients.editingId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : 'new';
      } else {
        Clients.editingId = null;
      }
    } else if (baseHash === '#admin') {
      if (pathParts[1] === 'users' && pathParts[2] === 'form') {
        Users.view = 'users';
        Users.editingId = (pathParts[3] && pathParts[3] !== 'new') ? pathParts[3] : 'new';
        Users.sidePeekId = null;
      } else if (pathParts[1]) {
        Users.view = pathParts[1];
        Users.sidePeekId = pathParts[2] || null;
        Users.editingId = null;
      } else {
        Users.sidePeekId = null;
        Users.editingId = null;
      }
    }

    const moduleMap = {
      '#dashboard': Dashboard,
      '#clients': Clients,
      '#operations': Workflow,
      '#billing': Billing,
      '#disbursement': Disbursement,
      '#transmittal': Transmittal,
      '#reports': Reports,
      '#admin': Users,
      '#profile': Profile
    };

    // Restrict reports and disbursement based on RBAC
    if (baseHash === '#reports' && !Auth.can('reports:view')) {
       location.hash = '#dashboard';
       return;
    }
    if (baseHash === '#disbursement' && !Auth.can('disbursement:view')) {
       location.hash = '#dashboard';
       return;
    }
    if (baseHash === '#transmittal' && !Auth.can('transmittal:view') && !Auth.can('transmittal:request')) {
       location.hash = '#dashboard';
       return;
    }

    const module = moduleMap[baseHash];
    const previousModuleKey = this.currentModule;
    this.currentModule = baseHash.replace('#', '');
    const content = document.getElementById('content');

    if (module && module.render) {
      const previousModule = moduleMap[`#${previousModuleKey}`];
      if (previousModule && previousModule !== module && typeof previousModule.cleanup === 'function') {
        previousModule.cleanup();
      }

      // If the module has warm data for the current entity, skip the skeleton
      // overlay and let the module render from cache immediately. Modules expose
      // a simple contract: hasCachedData(entity) returns true when data is usable.
      const entity = Auth.activeEntity;
      const hasCache = typeof module.hasCachedData === 'function' && module.hasCachedData(entity);
      if (!hasCache) {
        content.innerHTML = this.renderRouteSkeleton(rawHash);
      }

      const rendered = await module.render(routeId);

      // Race guard: a newer handleRoute() wins; do not commit stale render output.
      if (routeId !== this._routeId) {
        performance.mark('route-end-' + routeId);
        performance.measure('route-switch-' + routeId, 'route-start-' + routeId, 'route-end-' + routeId);
        this._reportRouteTelemetry(routeId, baseHash, hasCache);
        return;
      }

      content.replaceChildren();
      if (typeof rendered === 'string') {
        content.innerHTML = rendered;
      } else if (rendered) {
        content.appendChild(rendered);
      }

      performance.mark('route-end-' + routeId);
      performance.measure('route-switch-' + routeId, 'route-start-' + routeId, 'route-end-' + routeId);
      this._reportRouteTelemetry(routeId, baseHash, hasCache);

      if (module.init) module.init();
      this.highlightNav(rawHash);
      this.updateEntityBadge();
      this.updateSidebarNotifications();
      requestAnimationFrame(() => this.updateStickyTrayOffset());
    }
  },

  highlightNav(hash) {
    const baseHash = hash.split('?')[0].split('/')[0];
    document.querySelectorAll('nav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === baseHash);
    });
  },

  getPreferredViewMode(module) {
    const key = `erp_preferred_view_${module}`;
    const stored = localStorage.getItem(key);
    if (module === 'operations' || module === 'billing' || module === 'disbursement' || module === 'transmittals') {
      if (!stored || stored === 'card') return 'board';
    }
    if (stored === 'list' || stored === 'table' || stored === 'board') return stored;
    return 'list';
  },

  setPreferredViewMode(module, mode) {
    const key = `erp_preferred_view_${module}`;
    if (mode === 'list' || mode === 'table' || mode === 'board') {
      localStorage.setItem(key, mode);
    }
  },

  saveFilters(module, filterMap) {
    const key = `erp_filters_${module}`;
    try { sessionStorage.setItem(key, JSON.stringify(filterMap)); } catch (e) { /* ignore */ }
  },

  restoreFilters(module) {
    const key = `erp_filters_${module}`;
    try {
      const stored = sessionStorage.getItem(key);
      return stored ? JSON.parse(stored) : null;
    } catch (e) { return null; }
  },

  hasSavedFilters(module, keys = ['assignee', 'status', 'client', 'fund', 'priority', 'dueDate']) {
    const saved = this.restoreFilters(module);
    if (!saved) return false;
    return keys.some(key => {
      const v = saved[key];
      return Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim());
    });
  },

  clearSavedFilters(module) {
    const key = `erp_filters_${module}`;
    try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
  },

  saveGroupBy(module, groupBy) {
    const key = `erp_group_${module}`;
    try { sessionStorage.setItem(key, groupBy); } catch (e) { /* ignore */ }
  },

  restoreGroupBy(module) {
    const key = `erp_group_${module}`;
    try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
  },

  clearGroupBy(module) {
    const key = `erp_group_${module}`;
    try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
  },

  saveSort(module, sort) {
    const key = `erp_sort_${module}`;
    try { sessionStorage.setItem(key, sort); } catch (e) { /* ignore */ }
  },

  restoreSort(module) {
    const key = `erp_sort_${module}`;
    try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
  },

  clearSort(module) {
    const key = `erp_sort_${module}`;
    try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
  },

  updateStickyOffsets() {
    const activeModule = this.currentModule;
    if (!activeModule) return;

    const container = document.getElementById('content');
    if (!container) return;

    // 1. Generic page elements
    const titleBar = container.querySelector('.page-title-bar-v2');
    let titleBarHeight = 48;
    if (titleBar) {
      titleBarHeight = titleBar.getBoundingClientRect().height - 20;
    }

    const tabNav = container.querySelector('.module-tab-nav');
    let tabNavHeight = 45;
    if (tabNav) {
      tabNavHeight = tabNav.getBoundingClientRect().height;
    }

    // Set scoped CSS custom variables on the content container
    container.style.setProperty(`--${activeModule}-title-bar-height`, `${titleBarHeight}px`);
    container.style.setProperty(`--${activeModule}-tab-nav-height`, `${tabNavHeight}px`);

    const toolbar = container.querySelector(`.${activeModule}-tab-page .toolbar-sticky-container`);
    let toolbarHeight = 0;
    if (toolbar) {
      toolbarHeight = toolbar.getBoundingClientRect().height;
    }
    container.style.setProperty(`--${activeModule}-toolbar-height`, `${toolbarHeight}px`);

    // 2. Specific detail views
    const detailTitleBar = container.querySelector('.project-detail-v2 .page-title-bar-v2');
    let detailTitleBarHeight = 48;
    if (detailTitleBar) {
      detailTitleBarHeight = detailTitleBar.getBoundingClientRect().height - 20;
    }
    container.style.setProperty('--project-detail-title-bar-height', `${detailTitleBarHeight}px`);

    const detailToolbar = container.querySelector('.project-detail-v2 .task-view-toolbar');
    let detailToolbarHeight = 40;
    if (detailToolbar) {
      detailToolbarHeight = detailToolbar.getBoundingClientRect().height;
    }
    container.style.setProperty('--project-detail-toolbar-height', `${detailToolbarHeight}px`);
  }
};

// Expose App globally so helpers loaded earlier (e.g. js/utils.js) can invoke routing.
window.App = App;

// Login form wiring
document.addEventListener('DOMContentLoaded', async () => {
  App.initTheme();
  App.setupThemeToggle();

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('login-error');

      const loginResult = await Auth.login(email, password);
      if (loginResult === true) {
        if (errorEl) errorEl.classList.add('hidden');
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-shell').classList.remove('hidden');
        await App.init();
      } else {
        if (errorEl) {
          errorEl.textContent = loginResult === 'disabled'
            ? 'Your account has been disabled. Please contact the administrator.'
            : 'Invalid email or password.';
          errorEl.classList.remove('hidden');
        }
      }
    });
  }

  const hasSession = await Auth.restoreSession();
  const loadingScreen = document.getElementById('loading-screen');

  if (hasSession) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    await App.init();
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    sessionStorage.removeItem('is_syncing');
    sessionStorage.removeItem('pending_toast');
    document.documentElement.classList.remove('loading-active');
  }

  // Clear the show timeout to prevent it from firing if the page loaded fast
  if (window.LoadingManager && typeof window.LoadingManager.clear === 'function') {
    window.LoadingManager.clear();
  }

  const showPendingToast = () => {
    const pendingToast = sessionStorage.getItem('pending_toast');
    if (pendingToast) {
      sessionStorage.removeItem('pending_toast');
      try {
        const { title, message, type } = JSON.parse(pendingToast);
        if (typeof Workflow !== 'undefined' && typeof Workflow.showMessage === 'function') {
          Workflow.showMessage(title, message, type);
        }
      } catch (e) {
        console.error('Error parsing pending toast:', e);
      }
    }
  };

  // Handle fading out of loading screen if active
  if (document.documentElement.classList.contains('loading-active') && loadingScreen) {
    // Rely entirely on the CSS transition timing function by only toggling the opacity property
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
      document.documentElement.classList.remove('loading-active');
      loadingScreen.classList.add('hidden');
      loadingScreen.style.opacity = '';
      showPendingToast(); // Show modal only after loading screen is completely faded out
    }, window.LoadingManager ? window.LoadingManager.TRANSITION_MS : 250);
  } else {
    if (loadingScreen) loadingScreen.classList.add('hidden');
    showPendingToast(); // Show modal immediately if loading screen was not active
  }
  
  // Always ensure is_syncing is cleared after routing and initialization
  sessionStorage.removeItem('is_syncing');
});
