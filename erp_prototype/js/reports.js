/**
 * Reporting & Analytics Module
 *
 * Migrated from localStorage/DB.* calculations to the Node.js backend API.
 * Uses window.apiClient.reports endpoints and userCache/clientCache for name lookups.
 *
 * Backend gaps to address:
 * - Daily/weekly/monthly reports do not include task or time-log aggregates; the UI now
 *   renders the activity summaries returned by the backend (work requests, invoices,
 *   payments, disbursements, documents, transmittals).
 * - Analytics does not break billing/disbursements down by entity, PF/gov't fee type,
 *   fund source, or employee; those cards have been replaced with the totals the API provides.
 * - There is no top-level task list endpoint, so task-level reports cannot be surfaced
 *   without fetching every work request's tasks individually.
 */

const Reports = {
  tab: 'analytics', // 'analytics' | 'daily' | 'weekly' | 'monthly'
  viewMode: null,

  dailyDate: '',
  weeklyDate: '',
  monthlyMonth: '',

  render() {
    if (!Auth.can('reports:view')) {
      return el('div', { class: 'page' }, [
        renderEmptyState('Permission denied', 'You do not have permission to view reports.', { variant: 'zero-state' })
      ]);
    }

    if (!this.viewMode) this.viewMode = App.getPreferredViewMode('reports');
    if (!this.dailyDate) this.dailyDate = new Date().toISOString().slice(0, 10);
    if (!this.weeklyDate) this.weeklyDate = new Date().toISOString().slice(0, 10);
    if (!this.monthlyMonth) this.monthlyMonth = new Date().toISOString().slice(0, 7);

    const container = el('div', { class: 'page' });

    // Breadcrumb Title Bar
    const titleBar = el('div', { class: 'page-title-bar-v2' });
    const h1 = el('h1', { class: 'breadcrumb-h1' });
    const baseLink = el('a', { href: 'javascript:void(0)', class: 'breadcrumb-base', text: 'Reports' });
    baseLink.addEventListener('click', () => { this.tab = 'analytics'; App.handleRoute(); });

    const tabLabels = {
      'analytics': 'Analytics Overview',
      'daily': 'Daily Activity Report',
      'weekly': 'Weekly Activity Summary',
      'monthly': 'Monthly Pending Tasks'
    };

    h1.appendChild(baseLink);
    h1.appendChild(el('span', { class: 'breadcrumb-sep', text: '/' }));
    h1.appendChild(el('span', { text: tabLabels[this.tab] || 'Overview' }));
    titleBar.appendChild(h1);
    container.appendChild(titleBar);

    const tabs = el('div', { class: 'admin-tabs', style: 'margin-bottom: var(--spacing-lg);' });
    const tabDefs = [
      { key: 'analytics', label: 'Analytics' },
      { key: 'daily', label: 'Daily Report' },
      { key: 'weekly', label: 'Weekly Summary' },
      { key: 'monthly', label: 'Monthly Pending' }
    ];
    tabDefs.forEach(t => {
      const btn = el('button', {
        class: 'btn ' + (this.tab === t.key ? 'btn-primary' : 'btn-secondary'),
        text: t.label
      });
      btn.addEventListener('click', () => { this.tab = t.key; App.handleRoute(); });
      tabs.appendChild(btn);
    });
    container.appendChild(tabs);

    const content = el('div', { class: 'page-content-section' });

    if (this.tab === 'analytics') {
      content.appendChild(this.renderAnalytics());
    } else if (this.tab === 'daily') {
      content.appendChild(this.renderDailyReport());
    } else if (this.tab === 'weekly') {
      content.appendChild(this.renderWeeklySummary());
    } else {
      content.appendChild(this.renderMonthlyPending());
    }

    container.appendChild(content);
    return container;
  },

  init() {},

  getAccessibleEntities() {
    const active = Auth.activeEntity;
    if (active && active !== 'ALL') {
      return [active.toUpperCase()];
    }
    return (Auth.user?.entities || []).map(e => e.toUpperCase());
  },

  today() {
    return new Date().toISOString().slice(0, 10);
  },

  clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  },

  renderMiniStat(label, value, color) {
    const card = el('div', { class: 'report-mini-stat', style: `padding: var(--spacing-md); background: var(--color-surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); border-left: 4px solid var(--color-${color});` });
    card.appendChild(el('div', { text: label, style: 'font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;' }));
    card.appendChild(el('div', { text: String(value), style: 'font-size: 1.5rem; font-weight: 700; color: var(--color-text); margin-top: 4px;' }));
    return card;
  },

  renderReportTable(title, headers, rows) {
    const wrap = el('div', { style: 'margin-bottom: var(--spacing-lg);' });
    if (title) {
      wrap.appendChild(el('h3', { text: title, style: 'margin-bottom: var(--spacing-sm); font-size: 1rem; font-weight: 600;' }));
    }
    if (!rows || rows.length === 0) {
      wrap.appendChild(renderEmptyState('No items', null, { variant: 'compact' }));
      return wrap;
    }
    const table = el('table', { class: 'report-table' });
    table.appendChild(el('thead', {}, [
      el('tr', {}, headers.map(h => el('th', typeof h === 'string' ? { text: h } : h)))
    ]));
    const tbody = el('tbody');
    rows.forEach(r => {
      tbody.appendChild(el('tr', {}, r.map(cell => el('td', typeof cell === 'string' ? { text: cell } : cell))));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  },

  renderStatusBreakdown(title, byStatus) {
    const wrap = el('div', { class: 'report-card', style: 'padding: var(--spacing-md);' });
    if (title) wrap.appendChild(el('h3', { text: title, style: 'margin-bottom: var(--spacing-sm); font-size: 1rem;' }));
    if (!byStatus || Object.keys(byStatus).length === 0) {
      wrap.appendChild(el('div', { text: 'No status data available', style: 'color: var(--color-text-muted); font-size: 0.8125rem;' }));
      return wrap;
    }
    const list = el('div');
    Object.entries(byStatus).forEach(([status, count]) => {
      list.appendChild(el('div', {
        style: 'display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--color-border); font-size: 0.8125rem;'
      }, [
        el('span', { text: status }),
        el('span', { text: String(count), style: 'font-weight: 600;' })
      ]));
    });
    wrap.appendChild(list);
    return wrap;
  },

  renderLoadingState(container) {
    this.clearNode(container);
    container.appendChild(el('div', {
      class: 'empty-state-v2',
      html: '<div style="color:var(--color-text-muted);font-size:0.875rem;">Loading report…</div>'
    }));
  },

  renderErrorState(container, message) {
    this.clearNode(container);
    container.appendChild(renderEmptyState('Unable to load report', message || 'Please try again later.', { variant: 'zero-state' }));
  },

  // ============================================================
  // Analytics
  // ============================================================
  renderAnalytics() {
    const wrapper = el('div');
    const content = el('div');
    wrapper.appendChild(content);

    const refresh = async () => {
      this.renderLoadingState(content);
      try {
        const res = await window.apiClient.reports.analytics();
        const a = res.data || {};
        this.clearNode(content);

        const invoices = a.invoices || {};
        const disbursements = a.disbursements || {};
        const transmittals = a.transmittals || {};
        const revenue = a.revenue || {};

        // Summary row
        const summaryGrid = el('div', { class: 'report-stats-grid', style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--spacing-md); margin-bottom: var(--spacing-lg);' });
        summaryGrid.appendChild(this.renderMiniStat('Clients', (a.clients?.total ?? 0), 'blue'));
        summaryGrid.appendChild(this.renderMiniStat('Work Requests', (a.workRequests?.total ?? 0), 'indigo'));
        summaryGrid.appendChild(this.renderMiniStat('Active Documents', (a.documents?.total ?? 0), 'teal'));
        summaryGrid.appendChild(this.renderMiniStat('Invoices', invoices.total ?? 0, 'orange'));
        summaryGrid.appendChild(this.renderMiniStat('Disbursements', disbursements.total ?? 0, 'purple'));
        summaryGrid.appendChild(this.renderMiniStat('Transmittals', transmittals.total ?? 0, 'green'));
        content.appendChild(summaryGrid);

        // Bento detail cards
        const bento = el('div', { class: 'bento-grid' });

        // Billing Summary
        bento.appendChild(el('div', { class: 'bento-item bento-half report-card' }, [
          el('h2', { text: 'Billing Summary' }),
          this.renderReportTable(null,
            ['Metric', 'Amount'],
            [
              ['Total Billed', formatPHP(invoices.totalBilled || 0)],
              ['Total Collected', formatPHP(invoices.totalCollected || 0)],
              ['Total Outstanding', formatPHP(invoices.totalOutstanding || 0)]
            ]
          ),
          this.renderStatusBreakdown('By Status', invoices.byStatus)
        ]));

        // Disbursement Summary
        bento.appendChild(el('div', { class: 'bento-item bento-half report-card' }, [
          el('h2', { text: 'Disbursement Summary' }),
          this.renderReportTable(null,
            ['Metric', 'Amount'],
            [
              ['Total Recorded', formatPHP(disbursements.totalAmount || 0)],
              ['Released Amount', formatPHP(disbursements.releasedAmount || 0)]
            ]
          ),
          this.renderStatusBreakdown('By Status', disbursements.byStatus)
        ]));

        // Revenue / P&L
        bento.appendChild(el('div', { class: 'bento-item bento-half report-card' }, [
          el('h2', { text: 'Revenue & P&L' }),
          this.renderReportTable(null,
            ['Metric', 'Amount'],
            [
              ['Total Billed', formatPHP(revenue.totalBilled || 0)],
              ['Total Collected', formatPHP(revenue.totalCollected || 0)],
              ['Total Outstanding', formatPHP(revenue.totalOutstanding || 0)],
              ['Total Expenses', formatPHP(revenue.totalExpenses || 0)],
              ['Net Income', formatPHP(revenue.netIncome || 0)]
            ]
          )
        ]));

        // Transmittal Summary
        bento.appendChild(el('div', { class: 'bento-item bento-half report-card' }, [
          el('h2', { text: 'Transmittal Summary' }),
          this.renderReportTable(null,
            ['Metric', 'Value'],
            [
              ['Total', String(transmittals.total || 0)]
            ]
          ),
          this.renderStatusBreakdown('By Status', transmittals.byStatus)
        ]));

        content.appendChild(bento);
      } catch (e) {
        if (e.message === 'route-change' || e.name === 'AbortError') return;
        console.error('Analytics report failed', e);
        this.renderErrorState(content, e.message || 'Could not load analytics.');
      }
    };

    refresh();
    return wrapper;
  },

  // ============================================================
  // Daily Report
  // ============================================================
  renderDailyReport() {
    const wrapper = el('div');
    const controls = el('div', { class: 'filters-bar', style: 'margin-bottom: var(--spacing-md);' });
    controls.appendChild(el('span', { text: 'Date:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }));
    const dateInput = el('input', { type: 'date', class: 'form-select', value: this.dailyDate });
    controls.appendChild(wrapFilterFieldWithClear(dateInput));

    const reportContent = el('div');
    wrapper.appendChild(controls);
    wrapper.appendChild(reportContent);

    const refresh = async () => {
      this.renderLoadingState(reportContent);
      try {
        await Promise.all([
          window.apiClient.userCache.ensure(),
          window.apiClient.clientCache.ensure()
        ]);
        const res = await window.apiClient.reports.daily(this.dailyDate);
        const data = res.data || {};
        this.clearNode(reportContent);

        const summary = data.summary || {};
        const stats = el('div', { class: 'report-stats-grid', style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--spacing-md); margin-bottom: var(--spacing-lg);' });
        stats.appendChild(this.renderMiniStat('Work Requests', summary.workRequests || 0, 'blue'));
        stats.appendChild(this.renderMiniStat('Documents', summary.documents || 0, 'teal'));
        stats.appendChild(this.renderMiniStat('Invoices', summary.invoices || 0, 'orange'));
        stats.appendChild(this.renderMiniStat('Invoice Total', formatPHP(summary.invoicesTotal || 0), 'green'));
        stats.appendChild(this.renderMiniStat('Payments', summary.payments || 0, 'purple'));
        stats.appendChild(this.renderMiniStat('Payment Total', formatPHP(summary.paymentsTotal || 0), 'indigo'));
        stats.appendChild(this.renderMiniStat('Disbursements', summary.disbursements || 0, 'red'));
        stats.appendChild(this.renderMiniStat('Disbursement Total', formatPHP(summary.disbursementsTotal || 0), 'yellow'));
        stats.appendChild(this.renderMiniStat('Transmittals', summary.transmittals || 0, 'cyan'));
        reportContent.appendChild(stats);

        reportContent.appendChild(this.renderReportTable('Work Requests Created',
          ['Title', 'Status', 'Created'],
          (data.workRequests || []).map(wr => [wr.title || '—', wr.status || '—', wr.created_at ? formatDate(wr.created_at) : '—'])
        ));

        reportContent.appendChild(this.renderReportTable('Invoices Issued',
          ['Invoice #', 'Status', 'Total', 'Created'],
          (data.invoices || []).map(inv => [
            inv.invoice_number || inv.invoiceNumber || '—',
            inv.status || '—',
            formatPHP(inv.total || 0),
            inv.created_at ? formatDate(inv.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Payments Received',
          ['Amount', 'Method', 'Date', 'Invoice'],
          (data.payments || []).map(p => [
            formatPHP(p.amount || 0),
            p.method || '—',
            p.payment_date ? formatDate(p.payment_date) : (p.created_at ? formatDate(p.created_at) : '—'),
            p.invoice_id || '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Disbursements Filed',
          ['Number', 'Status', 'Amount', 'Created'],
          (data.disbursements || []).map(d => [
            d.disbursement_number || d.disbursementNumber || '—',
            d.status || '—',
            formatPHP(d.amount || 0),
            d.created_at ? formatDate(d.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Documents Uploaded',
          ['Name', 'Category', 'Created'],
          (data.documents || []).map(doc => [
            doc.original_name || doc.originalName || doc.name || '—',
            doc.category || '—',
            doc.created_at ? formatDate(doc.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Transmittals',
          ['Tracking #', 'Status', 'Created'],
          (data.transmittals || []).map(t => [
            t.tracking_number || t.trackingNumber || '—',
            t.status || '—',
            t.created_at ? formatDate(t.created_at) : '—'
          ])
        ));
      } catch (e) {
        if (e.message === 'route-change' || e.name === 'AbortError') return;
        console.error('Daily report failed', e);
        this.renderErrorState(reportContent, e.message || 'Could not load daily report.');
      }
    };

    dateInput.addEventListener('change', () => { this.dailyDate = dateInput.value; refresh(); });

    const refreshBtn = el('button', {
      class: 'btn btn-secondary btn-sm',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:middle;"><path d="M23 4v6h-6M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>Refresh'
    });
    refreshBtn.addEventListener('click', refresh);
    controls.appendChild(refreshBtn);

    refresh();
    return wrapper;
  },

  // ============================================================
  // Weekly Summary
  // ============================================================
  renderWeeklySummary() {
    const wrapper = el('div');
    const controls = el('div', { class: 'filters-bar', style: 'margin-bottom: var(--spacing-md);' });
    controls.appendChild(el('span', { text: 'Week of:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }));
    const weekInput = el('input', { type: 'date', class: 'form-select', value: this.weeklyDate });
    controls.appendChild(wrapFilterFieldWithClear(weekInput));

    const reportContent = el('div');
    wrapper.appendChild(controls);
    wrapper.appendChild(reportContent);

    const refresh = async () => {
      this.renderLoadingState(reportContent);
      try {
        await Promise.all([
          window.apiClient.userCache.ensure(),
          window.apiClient.clientCache.ensure()
        ]);
        const res = await window.apiClient.reports.weekly(this.weeklyDate);
        const data = res.data || {};
        this.clearNode(reportContent);

        const periodLabel = (data.weekStart && data.weekEnd)
          ? `${formatDate(data.weekStart)} – ${formatDate(data.weekEnd)}`
          : 'Selected week';
        reportContent.appendChild(el('h2', {
          text: periodLabel,
          style: 'margin-bottom: var(--spacing-md); font-size: 1.125rem; font-weight: 600;'
        }));

        const summary = data.summary || {};
        const stats = el('div', { class: 'report-stats-grid', style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--spacing-md); margin-bottom: var(--spacing-lg);' });
        stats.appendChild(this.renderMiniStat('Work Requests', summary.workRequests || 0, 'blue'));
        stats.appendChild(this.renderMiniStat('Invoices', summary.invoices || 0, 'orange'));
        stats.appendChild(this.renderMiniStat('Invoice Total', formatPHP(summary.invoicesTotal || 0), 'green'));
        stats.appendChild(this.renderMiniStat('Payments', summary.payments || 0, 'purple'));
        stats.appendChild(this.renderMiniStat('Payment Total', formatPHP(summary.paymentsTotal || 0), 'indigo'));
        stats.appendChild(this.renderMiniStat('Disbursements', summary.disbursements || 0, 'red'));
        stats.appendChild(this.renderMiniStat('Disbursement Total', formatPHP(summary.disbursementsTotal || 0), 'yellow'));
        stats.appendChild(this.renderMiniStat('Documents', summary.documents || 0, 'teal'));
        stats.appendChild(this.renderMiniStat('Transmittals', summary.transmittals || 0, 'cyan'));
        reportContent.appendChild(stats);

        const details = data.details || {};
        reportContent.appendChild(this.renderReportTable('Work Requests',
          ['Title', 'Status', 'Created'],
          (details.workRequests || []).map(wr => [wr.title || '—', wr.status || '—', wr.created_at ? formatDate(wr.created_at) : '—'])
        ));

        reportContent.appendChild(this.renderReportTable('Invoices',
          ['Invoice #', 'Status', 'Total', 'Created'],
          (details.invoices || []).map(inv => [
            inv.invoice_number || inv.invoiceNumber || '—',
            inv.status || '—',
            formatPHP(inv.total || 0),
            inv.created_at ? formatDate(inv.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Payments',
          ['Amount', 'Method', 'Created'],
          (details.payments || []).map(p => [
            formatPHP(p.amount || 0),
            p.method || '—',
            p.created_at ? formatDate(p.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Disbursements',
          ['Number', 'Status', 'Amount', 'Created'],
          (details.disbursements || []).map(d => [
            d.disbursement_number || d.disbursementNumber || '—',
            d.status || '—',
            formatPHP(d.amount || 0),
            d.created_at ? formatDate(d.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Documents',
          ['Name', 'Created'],
          (details.documents || []).map(doc => [
            doc.original_name || doc.originalName || doc.name || '—',
            doc.created_at ? formatDate(doc.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Transmittals',
          ['Tracking #', 'Status', 'Created'],
          (details.transmittals || []).map(t => [
            t.tracking_number || t.trackingNumber || '—',
            t.status || '—',
            t.created_at ? formatDate(t.created_at) : '—'
          ])
        ));
      } catch (e) {
        if (e.message === 'route-change' || e.name === 'AbortError') return;
        console.error('Weekly report failed', e);
        this.renderErrorState(reportContent, e.message || 'Could not load weekly report.');
      }
    };

    weekInput.addEventListener('change', () => { this.weeklyDate = weekInput.value; refresh(); });

    const refreshBtn = el('button', {
      class: 'btn btn-secondary btn-sm',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:middle;"><path d="M23 4v6h-6M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>Refresh'
    });
    refreshBtn.addEventListener('click', refresh);
    controls.appendChild(refreshBtn);

    refresh();
    return wrapper;
  },

  // ============================================================
  // Monthly Pending
  // ============================================================
  renderMonthlyPending() {
    const wrapper = el('div');
    const controls = el('div', { class: 'filters-bar', style: 'margin-bottom: var(--spacing-md);' });
    controls.appendChild(el('span', { text: 'Month:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }));
    const monthInput = el('input', { type: 'month', class: 'form-select', value: this.monthlyMonth });
    controls.appendChild(wrapFilterFieldWithClear(monthInput));

    const reportContent = el('div');
    wrapper.appendChild(controls);
    wrapper.appendChild(reportContent);

    const refresh = async () => {
      this.renderLoadingState(reportContent);
      try {
        await Promise.all([
          window.apiClient.userCache.ensure(),
          window.apiClient.clientCache.ensure()
        ]);
        const res = await window.apiClient.reports.monthlyPending(this.monthlyMonth);
        const data = res.data || {};
        this.clearNode(reportContent);

        reportContent.appendChild(el('h2', {
          text: 'Pending items for ' + (data.month || this.monthlyMonth),
          style: 'margin-bottom: var(--spacing-md); font-size: 1.125rem; font-weight: 600;'
        }));

        const overdue = data.overdueInvoices || {};
        const pendingDisb = data.pendingDisbursements || {};
        const stale = data.staleTransmittals || {};

        const stats = el('div', { class: 'report-stats-grid', style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--spacing-md); margin-bottom: var(--spacing-lg);' });
        stats.appendChild(this.renderMiniStat('Overdue Invoices', overdue.count || 0, 'danger'));
        stats.appendChild(this.renderMiniStat('Outstanding', formatPHP(overdue.totalOutstanding || 0), 'orange'));
        stats.appendChild(this.renderMiniStat('Pending Disbursements', pendingDisb.count || 0, 'purple'));
        stats.appendChild(this.renderMiniStat('Pending Disb. Total', formatPHP(pendingDisb.totalAmount || 0), 'yellow'));
        stats.appendChild(this.renderMiniStat('Stale Draft Transmittals', stale.count || 0, 'cyan'));
        reportContent.appendChild(stats);

        reportContent.appendChild(this.renderReportTable('Overdue Invoices',
          ['Invoice #', 'Client', 'Due Date', 'Total', 'Balance', 'Status'],
          (overdue.items || []).map(inv => {
            const client = inv.client_id
              ? window.apiClient.clientCache.getById(inv.client_id)
              : null;
            return [
              inv.invoice_number || inv.invoiceNumber || '—',
              client?.name || inv.clients?.name || 'Unknown',
              inv.due_date ? formatDate(inv.due_date) : '—',
              formatPHP(inv.total || 0),
              formatPHP(inv.balance || 0),
              inv.status || '—'
            ];
          })
        ));

        reportContent.appendChild(this.renderReportTable('Pending Disbursements',
          ['Number', 'Amount', 'Status', 'Category', 'Created'],
          (pendingDisb.items || []).map(d => [
            d.disbursement_number || d.disbursementNumber || '—',
            formatPHP(d.amount || 0),
            d.status || '—',
            d.category || '—',
            d.created_at ? formatDate(d.created_at) : '—'
          ])
        ));

        reportContent.appendChild(this.renderReportTable('Stale Draft Transmittals',
          ['Tracking #', 'Client', 'Created', 'Status'],
          (stale.items || []).map(t => {
            const client = t.client_id
              ? window.apiClient.clientCache.getById(t.client_id)
              : null;
            return [
              t.tracking_number || t.trackingNumber || '—',
              client?.name || t.clients?.name || 'Unknown',
              t.created_at ? formatDate(t.created_at) : '—',
              t.status || '—'
            ];
          })
        ));
      } catch (e) {
        if (e.message === 'route-change' || e.name === 'AbortError') return;
        console.error('Monthly pending report failed', e);
        this.renderErrorState(reportContent, e.message || 'Could not load monthly pending report.');
      }
    };

    monthInput.addEventListener('change', () => { this.monthlyMonth = monthInput.value; refresh(); });

    const refreshBtn = el('button', {
      class: 'btn btn-secondary btn-sm',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:middle;"><path d="M23 4v6h-6M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>Refresh'
    });
    refreshBtn.addEventListener('click', refresh);
    controls.appendChild(refreshBtn);

    refresh();
    return wrapper;
  }
};
