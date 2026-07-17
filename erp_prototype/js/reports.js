/**
 * Reporting & Analytics Module
 * Analytics dashboard, Daily Report, Weekly Summary, Monthly Pending.
 */

const Reports = {
  tab: 'analytics', // 'analytics' | 'daily' | 'weekly' | 'monthly'
  viewMode: null,

  filters: {
    workRequest: '',
    client: '',
    clientText: '',
    employee: '',
    dateFrom: '',
    dateTo: ''
  },

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
      'daily': 'Daily Task Report',
      'weekly': 'Weekly Performance Summary',
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
      const entities = this.getAccessibleEntities();
      content.appendChild(el('div', { class: 'bento-grid' }, [
        this.renderWorkRequestVolume(entities),
        this.renderTaskCompletion(entities),
        this.renderBillingSummary(entities),
        this.renderDisbursementReport(entities),
        this.renderEntityPL(entities)
      ]));
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

  filterByEntity(items, entities) {
    const upper = entities.map(e => e.toUpperCase());
    return items.filter(i => upper.includes(i.entity?.toUpperCase?.()));
  },

  today() {
    return new Date().toISOString().slice(0, 10);
  },

  daysBetween(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    const diff = e - s;
    return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
  },

  getMonday(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
  },

  getWeekRange(dateStr) {
    const monday = this.getMonday(dateStr);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10)
    };
  },

  getMonthRange(monthStr) {
    const [year, month] = monthStr.split('-').map(Number);
    const start = `${monthStr}-01`;
    const endDate = new Date(year, month, 0);
    const end = `${monthStr}-${String(endDate.getDate()).padStart(2, '0')}`;
    return { start, end };
  },

  // ============================================================
  // Common Components
  // ============================================================
  renderFilterBar(excludeDateRange, onChange) {
    const bar = el('div', { class: 'filters-bar', style: 'margin-bottom: var(--spacing-md);' });
    const entities = this.getAccessibleEntities();

    const triggerChange = () => {
      if (onChange) onChange();
      else App.handleRoute();
    };

    // Work Request
    const wrSel = el('select', { class: 'form-select' });
    wrSel.appendChild(el('option', { value: '', text: '— Work Request —' }));
    DB.getAll('workRequests').filter(wr => entities.includes(wr.entity?.toUpperCase?.())).forEach(wr => {
      wrSel.appendChild(el('option', { value: wr.id, text: wr.title }));
    });
    wrSel.value = this.filters.workRequest;
    wrSel.addEventListener('change', () => { this.filters.workRequest = wrSel.value; triggerChange(); });
    bar.appendChild(wrapFilterFieldWithClear(wrSel));

    // Client
    const clientOptions = [{ value: '', text: '— Client —' }];
    DB.getAll('clients').filter(c => entities.includes(c.entity?.toUpperCase?.())).forEach(c => {
      clientOptions.push({ value: c.id, text: c.name });
    });
    const clientFilter = createSearchableDropdown({ placeholder: '— Client —', options: clientOptions });
    clientFilter.value = this.filters.client;
    this.filters.clientText = clientFilter.searchText || '';

    clientFilter.addEventListener('change', () => {
      this.filters.client = clientFilter.value;
      this.filters.clientText = clientFilter.searchText;
      triggerChange();
    });
    clientFilter.addEventListener('input', () => {
      this.filters.client = clientFilter.value;
      this.filters.clientText = clientFilter.searchText;
      triggerChange();
    });
    bar.appendChild(clientFilter);

    // Employee
    const empOptions = [{ value: '', text: '— Employee —' }];
    DB.getAll('users').forEach(u => {
      empOptions.push({ value: u.id, text: u.name });
    });
    (DB.getAll('tasks') || []).forEach(t => {
      const name = (t.assigneeName || '').trim();
      if (name && !empOptions.some(opt => opt.value === name || opt.text === name)) {
        empOptions.push({ value: name, text: name });
      }
    });
    const empFilter = createSearchableDropdown({ placeholder: '— Employee —', options: empOptions });
    empFilter.value = this.filters.employee;
    empFilter.addEventListener('change', () => { this.filters.employee = empFilter.value; triggerChange(); });
    empFilter.addEventListener('input', () => { triggerChange(); });
    this.empFilter = empFilter;
    bar.appendChild(empFilter);

    // Due Date range
    if (!excludeDateRange) {
      const fromInput = el('input', { type: 'date', class: 'form-select', value: this.filters.dateFrom });
      fromInput.addEventListener('change', () => { this.filters.dateFrom = fromInput.value; triggerChange(); });
      bar.appendChild(el('span', { text: 'From:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }));
      bar.appendChild(wrapFilterFieldWithClear(fromInput));

      const toInput = el('input', { type: 'date', class: 'form-select', value: this.filters.dateTo });
      toInput.addEventListener('change', () => { this.filters.dateTo = toInput.value; triggerChange(); });
      bar.appendChild(el('span', { text: 'To:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }));
      bar.appendChild(wrapFilterFieldWithClear(toInput));
    }

    const clearBtn = el('button', {
      class: 'btn btn-secondary btn-sm',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 .49-3.5"></path></svg>Clear'
    });
    clearBtn.addEventListener('click', () => {
      this.filters = { workRequest: '', client: '', clientText: '', employee: '', dateFrom: '', dateTo: '' };
      wrSel.value = '';
      clientFilter.value = '';
      empFilter.value = '';
      if (!excludeDateRange) {
        fromInput.value = '';
        toInput.value = '';
      }
      triggerChange();
    });
    bar.appendChild(clearBtn);

    return bar;
  },

  renderViewModeToggle() {
    const toggle = el('div', { class: 'view-mode-toggle', style: 'margin-bottom: var(--spacing-lg);' });
    const viewIcons = { 
      'table': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>', 
      'board': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>', 
      'list': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' 
    };
    ['table', 'board', 'list'].forEach(mode => {
      const btn = el('button', { html: (viewIcons[mode] || '') + ' ' + mode.charAt(0).toUpperCase() + mode.slice(1) });
      if (this.viewMode === mode) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.viewMode = mode;
        App.setPreferredViewMode('reports', mode);
        App.handleRoute();
      });
      toggle.appendChild(btn);
    });
    return toggle;
  },

  getFilteredTasks() {
    const entities = this.getAccessibleEntities();
    const wrs = DB.getAll('workRequests');
    let tasks = DB.getAll('tasks').filter(t => {
      const wr = wrs.find(w => w.id === t.workRequestId);
      return wr && entities.includes(wr.entity?.toUpperCase?.());
    });

    if (this.filters.workRequest) {
      tasks = tasks.filter(t => t.workRequestId === this.filters.workRequest);
    }
    if (this.filters.client || (this.filters.clientText && this.filters.clientText.trim() !== '')) {
      const selectedClient = this.filters.client ? DB.getById('clients', this.filters.client) : null;
      if (selectedClient && selectedClient.name === this.filters.clientText) {
        tasks = tasks.filter(t => {
          const wr = wrs.find(w => w.id === t.workRequestId);
          return wr && wr.clientId === this.filters.client;
        });
      } else if (this.filters.clientText && this.filters.clientText.trim() !== '') {
        const query = this.filters.clientText.trim().toLowerCase();
        tasks = tasks.filter(t => {
          const wr = wrs.find(w => w.id === t.workRequestId);
          if (!wr) return false;
          const client = DB.getById('clients', wr.clientId);
          return client && client.name.toLowerCase().includes(query);
        });
      }
    }
    if (this.empFilter && this.empFilter.searchText && this.empFilter.searchText.trim() !== '') {
      const query = this.empFilter.searchText.trim().toLowerCase();
      tasks = tasks.filter(t => {
        if (t.assigneeId) {
          const u = DB.getById('users', t.assigneeId);
          if (u && u.name.toLowerCase().includes(query)) return true;
        }
        if (t.assignedTo) {
          const u = DB.getById('users', t.assignedTo);
          if (u && u.name.toLowerCase().includes(query)) return true;
        }
        if (t.assigneeName && t.assigneeName.toLowerCase().includes(query)) return true;
        return false;
      });
    } else if (this.filters.employee) {
      tasks = tasks.filter(t => (t.assigneeId || t.assignedTo) === this.filters.employee);
    }
    if (this.filters.dateFrom) {
      tasks = tasks.filter(t => !t.dueDate || t.dueDate >= this.filters.dateFrom);
    }
    if (this.filters.dateTo) {
      tasks = tasks.filter(t => !t.dueDate || t.dueDate <= this.filters.dateTo);
    }

    return tasks;
  },

  renderTaskTable(tasks) {
    const wrs = DB.getAll('workRequests');
    const clients = DB.getAll('clients');

    const table = el('table', { class: 'report-table' });
    table.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Task' }),
        el('th', { text: 'Client' }),
        el('th', { text: 'Assignee' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'Due Date' })
      ])
    ]));

    const tbody = el('tbody');
    tasks.forEach(t => {
      const wr = wrs.find(w => w.id === t.workRequestId);
      const client = wr ? clients.find(c => c.id === wr.clientId) : null;
      const assignee = t.assigneeName
        ? { name: t.assigneeName }
        : DB.getById('users', t.assigneeId || t.assignedTo);
      tbody.appendChild(el('tr', {}, [
        el('td', { text: t.title }),
        el('td', { text: client?.name || '—' }),
        el('td', { text: assignee?.name || '—' }),
        el('td', { text: t.status }),
        el('td', { text: t.dueDate ? formatDate(t.dueDate) : '—' })
      ]));
    });
    table.appendChild(tbody);
    return table;
  },

  renderTaskBoard(tasks) {
    if (tasks.length === 0) {
      return renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        title: 'No tasks found',
        body: 'Adjust your filters to include tasks in this report.'
      });
    }

    const statuses = ['Draft', 'Assigned', 'In Progress', 'For Review', 'Completed', 'Cancelled'];
    const statusColors = { 'Draft': '#94a3b8', 'Assigned': '#3b82f6', 'In Progress': '#f59e0b', 'For Review': '#a855f7', 'Completed': '#10b981', 'Cancelled': '#ef4444' };
    const wrs = DB.getAll('workRequests');
    const clients = DB.getAll('clients');
    let taskNumber = 1;

    return KanbanBoard.render({
      items: tasks,
      columns: statuses.map(status => ({
        key: status,
        label: status,
        targetStatus: status,
        color: statusColors[status] || '#cbd5e1',
        emptyState: { variant: 'compact', title: 'No tasks', body: '' }
      })),
      renderCard(t) {
        const wr = wrs.find(w => w.id === t.workRequestId);
        const client = wr ? clients.find(c => c.id === wr.clientId) : null;
        const assignee = t.assigneeName
          ? { name: t.assigneeName }
          : DB.getById('users', t.assigneeId || t.assignedTo);
        const comp = getTaskChecklistCompletion(t);

        const priorityConfig = {
          'Urgent': { label: 'Urgent', cls: 'card-v2-priority-urgent' },
          'Priority': { label: 'High', cls: 'card-v2-priority-high' },
          'High': { label: 'High', cls: 'card-v2-priority-high' },
          'Low Priority': { label: 'Low', cls: 'card-v2-priority-low' },
          'Low': { label: 'Low', cls: 'card-v2-priority-low' }
        }[t.priority] || { label: t.priority || 'Normal', cls: 'card-v2-priority-normal' };

        const avatars = assignee ? [{
          name: assignee.name,
          avatarUrl: assignee.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(assignee.name)}&background=2563eb&color=fff`
        }] : [];

        const counts = [];
        if (comp.total > 0) counts.push({ icon: BoardCardIcons.checklist, value: `${comp.percent}%` });

        return buildCompactBoardCard({
          key: 'TSK-' + taskNumber++,
          progress: comp.percent,
          statusColor: statusColors[t.status] || '#cbd5e1',
          title: t.title,
          description: client?.name || '',
          date: t.dueDate ? formatDate(t.dueDate) : '',
          priority: priorityConfig.label,
          priorityClass: priorityConfig.cls,
          avatars,
          counts,
          onClick: () => { /* reports board is read-only summary */ }
        });
      },
      drag: { enabled: false }
    });
  },

  renderTaskList(tasks) {
    const list = el('div', { class: 'list-view' });
    const wrs = DB.getAll('workRequests');
    const clients = DB.getAll('clients');

    tasks.forEach(t => {
      const wr = wrs.find(w => w.id === t.workRequestId);
      const client = wr ? clients.find(c => c.id === wr.clientId) : null;
      const assignee = t.assigneeName
        ? { name: t.assigneeName }
        : DB.getById('users', t.assigneeId || t.assignedTo);

      const item = el('div', { class: 'list-item' });
      const left = el('div');
      left.appendChild(el('div', { class: 'list-item-title', text: t.title }));
      left.appendChild(el('div', { class: 'list-item-meta', text: (client?.name || '—') + ' • ' + (assignee?.name || '—') + ' • Due ' + (t.dueDate ? formatDate(t.dueDate) : '—') }));
      item.appendChild(left);
      
      const statusBadge = el('span', { class: 'badge', text: t.status });
      const s = t.status.toLowerCase();
      if (s === 'completed') statusBadge.classList.add('badge-success');
      else if (s === 'cancelled') statusBadge.classList.add('badge-danger');
      else if (['assigned', 'in progress', 'for review'].includes(s)) statusBadge.classList.add('badge-warning');
      else statusBadge.classList.add('badge-info');
      
      item.appendChild(statusBadge);
      list.appendChild(item);
    });
    return list;
  },

  // ============================================================
  // Daily Report
  // ============================================================
  renderDailyReport() {
    const wrapper = el('div');
    const reportContentContainer = el('div');

    const refresh = () => {
      reportContentContainer.innerHTML = '';

      const tasks = this.getFilteredTasks().filter(t => {
        const logs = t.timeLogs || [];
        return logs.some(l => l.date === this.dailyDate);
      });

      // Meaningful Stats for the day
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === 'Completed').length;
      const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const totalHours = tasks.reduce((sum, t) => {
          const logs = (t.timeLogs || []).filter(l => l.date === this.dailyDate);
          return sum + logs.reduce((s, l) => s + (l.hours || 0), 0);
      }, 0);

      const statsGrid = el('div', { class: 'report-stats-grid', style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--spacing-md); margin-bottom: var(--spacing-lg);' });
      statsGrid.appendChild(this.renderMiniStat('Total Tasks Logged', totalTasks, 'blue'));
      statsGrid.appendChild(this.renderMiniStat('Completed Today', completedTasks, 'green'));
      statsGrid.appendChild(this.renderMiniStat('Daily Completion Rate', completionRate + '%', 'orange'));
      statsGrid.appendChild(this.renderMiniStat('Total Man-Hours', totalHours.toFixed(1), 'purple'));
      reportContentContainer.appendChild(statsGrid);

      if (tasks.length === 0) {
        reportContentContainer.appendChild(renderEmptyState('No tasks with time logs', 'No time logs recorded for ' + formatDate(this.dailyDate) + '.', { variant: 'zero-state' }));
        return;
      }

      if (this.viewMode === 'table') {
        reportContentContainer.appendChild(this.renderDailyTable(tasks));
      } else if (this.viewMode === 'board') {
        reportContentContainer.appendChild(this.renderTaskBoard(tasks));
      } else {
        reportContentContainer.appendChild(this.renderTaskList(tasks));
      }
    };

    const filters = this.renderFilterBar(true, refresh);
    const dateInput = el('input', { type: 'date', class: 'form-select', value: this.dailyDate });
    dateInput.addEventListener('change', () => { this.dailyDate = dateInput.value; refresh(); });
    filters.insertBefore(el('span', { text: 'Date:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }), filters.firstChild);
    filters.insertBefore(dateInput, filters.firstChild.nextSibling);
    wrapper.appendChild(filters);

    wrapper.appendChild(this.renderViewModeToggle());
    wrapper.appendChild(reportContentContainer);

    refresh();

    return wrapper;
  },

  renderMiniStat(label, value, color) {
    const card = el('div', { class: 'report-mini-stat', style: `padding: var(--spacing-md); background: var(--color-surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); border-left: 4px solid var(--color-${color});` });
    card.appendChild(el('div', { text: label, style: 'font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;' }));
    card.appendChild(el('div', { text: String(value), style: 'font-size: 1.5rem; font-weight: 700; color: var(--color-text); margin-top: 4px;' }));
    return card;
  },

  renderDailyTable(tasks) {
    const wrs = DB.getAll('workRequests');
    const clients = DB.getAll('clients');

    const table = el('table', { class: 'report-table' });
    table.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Employee' }),
        el('th', { text: 'Task' }),
        el('th', { text: 'Client' }),
        el('th', { text: 'Start Time' }),
        el('th', { text: 'End Time' }),
        el('th', { text: 'Hours' }),
        el('th', { text: 'Status' })
      ])
    ]));

    const tbody = el('tbody');
    tasks.forEach(t => {
      const wr = wrs.find(w => w.id === t.workRequestId);
      const client = wr ? clients.find(c => c.id === wr.clientId) : null;
      const logs = (t.timeLogs || []).filter(l => l.date === this.dailyDate);

      logs.forEach(log => {
        const user = DB.getById('users', log.userId || t.assigneeId || t.assignedTo);
        tbody.appendChild(el('tr', {}, [
          el('td', { text: user?.name || '—' }),
          el('td', { text: t.title, style: 'font-weight:600;' }),
          el('td', { text: client?.name || '—' }),
          el('td', { text: log.startTime || '—' }),
          el('td', { text: log.endTime || '—' }),
          el('td', { text: String(log.hours || 0), class: 'num' }),
          el('td', { text: t.status })
        ]));
      });
    });

    table.appendChild(tbody);
    return table;
  },

  // ============================================================
  // Weekly Summary
  // ============================================================
  renderWeeklySummary() {
    const wrapper = el('div');
    const reportContentContainer = el('div');

    const refresh = () => {
      reportContentContainer.innerHTML = '';

      const { start, end } = this.getWeekRange(this.weeklyDate);
      const tasks = this.getFilteredTasks().filter(t => {
        if (!t.dueDate) return false;
        return t.dueDate >= start && t.dueDate <= end;
      });

      // Summary by employee
      const summary = {};
      DB.getAll('users').forEach(u => {
        summary[u.id] = { name: u.name, completed: 0, pending: 0, overdue: 0, hours: 0 };
      });
      summary['unassigned'] = { name: 'Unassigned', completed: 0, pending: 0, overdue: 0, hours: 0 };

      const today = this.today();
      tasks.forEach(t => {
        const empId = t.assigneeId || t.assignedTo || 'unassigned';
        if (!summary[empId]) {
          summary[empId] = { name: 'Unknown', completed: 0, pending: 0, overdue: 0, hours: 0 };
        }
        
        const logs = (t.timeLogs || []).filter(l => l.date >= start && l.date <= end);
        summary[empId].hours += logs.reduce((s, l) => s + (l.hours || 0), 0);

        if (t.status === 'Completed') {
          summary[empId].completed++;
        } else if (t.status !== 'Cancelled') {
          summary[empId].pending++;
          if (t.dueDate < today) {
            summary[empId].overdue++;
          }
        }
      });

      const summaryRows = Object.values(summary).filter(s => s.completed > 0 || s.pending > 0 || s.hours > 0);
      const periodLabel = formatDate(start) + ' – ' + formatDate(end);

      // Weekly Stats Header
      const statsGrid = el('div', { class: 'report-stats-grid', style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--spacing-md); margin-bottom: var(--spacing-lg);' });
      const totalHrs = summaryRows.reduce((s, r) => s + r.hours, 0);
      const totalComp = summaryRows.reduce((s, r) => s + r.completed, 0);
      const totalPend = summaryRows.reduce((s, r) => s + r.pending, 0);
      statsGrid.appendChild(this.renderMiniStat('Total Weekly Hours', totalHrs.toFixed(1), 'blue'));
      statsGrid.appendChild(this.renderMiniStat('Total Tasks Completed', totalComp, 'green'));
      statsGrid.appendChild(this.renderMiniStat('Total Pending Tasks', totalPend, 'orange'));
      reportContentContainer.appendChild(statsGrid);

      if (summaryRows.length === 0) {
        reportContentContainer.appendChild(renderEmptyState('No tasks for the week', 'No tasks were completed or pending during the week of ' + periodLabel + '.', { variant: 'zero-state' }));
      } else {
        const table = el('table', { class: 'report-table' });
        table.appendChild(el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Employee' }),
            el('th', { text: 'Total Hours', class: 'num' }),
            el('th', { text: 'Completed', class: 'num' }),
            el('th', { text: 'Pending', class: 'num' }),
            el('th', { text: 'Overdue', class: 'num' })
          ])
        ]));
        const tbody = el('tbody');
        summaryRows.forEach(s => {
          tbody.appendChild(el('tr', {}, [
            el('td', { text: s.name, style: 'font-weight:600;' }),
            el('td', { text: s.hours.toFixed(1), class: 'num' }),
            el('td', { text: String(s.completed), class: 'num' }),
            el('td', { text: String(s.pending), class: 'num' }),
            el('td', { text: String(s.overdue), class: 'num', style: s.overdue > 0 ? 'color:var(--color-danger); font-weight:600;' : '' })
          ]));
        });
        table.appendChild(tbody);
        reportContentContainer.appendChild(table);
      }

      reportContentContainer.appendChild(el('h3', { text: 'Task Board', style: 'margin-top:var(--spacing-xl); margin-bottom: var(--spacing-md);' }));
      reportContentContainer.appendChild(this.renderViewModeToggle());

      if (tasks.length === 0) {
        reportContentContainer.appendChild(renderEmptyState('No tasks to display', 'No tasks are available for this weekly report.', { variant: 'zero-state' }));
      } else if (this.viewMode === 'table') {
        reportContentContainer.appendChild(this.renderTaskTable(tasks));
      } else if (this.viewMode === 'board') {
        reportContentContainer.appendChild(this.renderTaskBoard(tasks));
      } else {
        reportContentContainer.appendChild(this.renderTaskList(tasks));
      }
    };

    const filters = this.renderFilterBar(true, refresh);
    const weekInput = el('input', { type: 'date', class: 'form-select', value: this.weeklyDate });
    weekInput.addEventListener('change', () => { this.weeklyDate = weekInput.value; refresh(); });
    filters.insertBefore(el('span', { text: 'Week of:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }), filters.firstChild);
    filters.insertBefore(weekInput, filters.firstChild.nextSibling);
    wrapper.appendChild(filters);
    wrapper.appendChild(reportContentContainer);

    refresh();

    return wrapper;
  },

  // ============================================================
  // Monthly Pending
  // ============================================================
  renderMonthlyPending() {
    const wrapper = el('div');
    const reportContentContainer = el('div');

    const refresh = () => {
      reportContentContainer.innerHTML = '';

      const { start, end } = this.getMonthRange(this.monthlyMonth);
      const tasks = this.getFilteredTasks().filter(t => {
        if (t.status === 'Completed' || t.status === 'Cancelled') return false;
        if (!t.dueDate) return false;
        return t.dueDate >= start && t.dueDate <= end;
      });

      // Monthly Stats
      const totalPending = tasks.length;
      const overdueCount = tasks.filter(t => t.dueDate < this.today()).length;
      const statsGrid = el('div', { class: 'report-stats-grid', style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--spacing-md); margin-bottom: var(--spacing-lg);' });
      statsGrid.appendChild(this.renderMiniStat('Monthly Pending Tasks', totalPending, 'blue'));
      statsGrid.appendChild(this.renderMiniStat('Overdue Items', overdueCount, 'danger'));
      reportContentContainer.appendChild(statsGrid);

      if (tasks.length === 0) {
        reportContentContainer.appendChild(renderEmptyState('No pending tasks', 'No pending tasks recorded for ' + this.monthlyMonth + '.', { variant: 'zero-state' }));
      } else if (this.viewMode === 'table') {
        reportContentContainer.appendChild(this.renderPendingTable(tasks));
      } else if (this.viewMode === 'board') {
        reportContentContainer.appendChild(this.renderTaskBoard(tasks));
      } else {
        reportContentContainer.appendChild(this.renderTaskList(tasks));
      }

      // Retainer templates due this month
      const [year, month] = this.monthlyMonth.split('-').map(Number);
      const entities = this.getAccessibleEntities();
      const retainerTemplates = DB.getAll('retainerTemplates').filter(rt => {
        if (!entities.includes(rt.entity?.toUpperCase?.())) return false;
        if (rt.schedule === 'monthly') return true;
        if (rt.schedule === 'quarterly') return month % 3 === 0;
        return false;
      });

      const retainerSection = el('div', { style: 'margin-top:var(--spacing-xl);' });
      retainerSection.appendChild(el('h3', { text: 'Recurring Retainer Tasks Due This Month', style: 'margin-bottom: var(--spacing-md);' }));

      if (retainerTemplates.length === 0) {
        retainerSection.appendChild(renderEmptyState('No retainer templates due', 'No recurring retainer templates are due this month.', { variant: 'zero-state' }));
      } else {
        const rtTable = el('table', { class: 'report-table' });
        rtTable.appendChild(el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Template' }),
            el('th', { text: 'Client' }),
            el('th', { text: 'Schedule' }),
            el('th', { text: 'PF Amount' }),
            el('th', { text: 'Tasks' })
          ])
        ]));
        const rtBody = el('tbody');
        const clients = DB.getAll('clients');
        retainerTemplates.forEach(rt => {
          const client = clients.find(c => c.id === rt.clientId);
          rtBody.appendChild(el('tr', {}, [
            el('td', { text: rt.name, style: 'font-weight:600;' }),
            el('td', { text: client?.name || '—' }),
            el('td', { text: rt.schedule }),
            el('td', { class: 'num', text: formatPHP(rt.pfAmount || 0) }),
            el('td', { text: String((rt.tasks || []).length), class: 'num' })
          ]));
        });
        rtTable.appendChild(rtBody);
        retainerSection.appendChild(rtTable);
      }
      reportContentContainer.appendChild(retainerSection);
    };

    const filters = this.renderFilterBar(true, refresh);
    const monthInput = el('input', { type: 'month', class: 'form-select', value: this.monthlyMonth });
    monthInput.addEventListener('change', () => { this.monthlyMonth = monthInput.value; refresh(); });
    filters.insertBefore(el('span', { text: 'Month:', style: 'font-size:0.8125rem; font-weight:600; color:var(--color-text-muted);' }), filters.firstChild);
    filters.insertBefore(monthInput, filters.firstChild.nextSibling);
    wrapper.appendChild(filters);

    wrapper.appendChild(this.renderViewModeToggle());
    wrapper.appendChild(reportContentContainer);

    refresh();

    return wrapper;
  },

  renderPendingTable(tasks) {
    const wrs = DB.getAll('workRequests');
    const clients = DB.getAll('clients');

    const byEmployee = {};
    tasks.forEach(t => {
      const empId = t.assigneeId || t.assignedTo || 'unassigned';
      if (!byEmployee[empId]) byEmployee[empId] = [];
      byEmployee[empId].push(t);
    });

    const container = el('div');
    Object.entries(byEmployee).forEach(([empId, empTasks]) => {
      const emp = DB.getById('users', empId);
      container.appendChild(el('h4', {
        text: (emp?.name || 'Unassigned') + ' (' + empTasks.length + ')',
        style: 'margin:var(--spacing-md) 0 var(--spacing-sm); font-size:1rem; font-weight:600; color: var(--color-primary); border-bottom: 1px solid var(--color-border); padding-bottom: 4px;'
      }));

      const table = el('table', { class: 'report-table' });
      table.appendChild(el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Task' }),
          el('th', { text: 'Client' }),
          el('th', { text: 'Due Date' }),
          el('th', { text: 'Status' })
        ])
      ]));
      const tbody = el('tbody');
      empTasks.forEach(t => {
        const wr = wrs.find(w => w.id === t.workRequestId);
        const client = wr ? clients.find(c => c.id === wr.clientId) : null;
        tbody.appendChild(el('tr', {}, [
          el('td', { text: t.title, style: 'font-weight: 600;' }),
          el('td', { text: client?.name || '—' }),
          el('td', { text: formatDate(t.dueDate) }),
          el('td', { text: t.status })
        ]));
      });
      table.appendChild(tbody);
      container.appendChild(table);
    });
    return container;
  },

  // ─── Work Request Volume ─────────────────────────────────────────────
  renderWorkRequestVolume(entities) {
    const wrs = this.filterByEntity(DB.getAll('workRequests'), entities);
    const counts = {};
    wrs.forEach(wr => {
      counts[wr.status] = (counts[wr.status] || 0) + 1;
    });

    const chartContainer = el('div', { class: 'chart-container' });
    chartContainer.innerHTML = `
      <svg class="smooth-line-chart" viewBox="0 0 600 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="report-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.8" />
            <stop offset="100%" stop-color="var(--color-surface)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path class="smooth-line-bg" style="fill: url(#report-gradient);" d="M 0,180 C 100,180 150,60 250,90 C 350,120 400,150 500,100 C 550,70 580,40 600,60 L 600,200 L 0,200 Z" />
        <path class="smooth-line" d="M 0,180 C 100,180 150,60 250,90 C 350,120 400,150 500,100 C 550,70 580,40 600,60" />
        <text x="0" y="195" class="chart-x-axis">Jan</text>
        <text x="150" y="195" class="chart-x-axis">Feb</text>
        <text x="300" y="195" class="chart-x-axis">Mar</text>
        <text x="450" y="195" class="chart-x-axis">Apr</text>
        <text x="580" y="195" class="chart-x-axis">May</text>
      </svg>
    `;

    return el('div', { class: 'bento-item bento-two-thirds report-card' }, [
      el('h2', { text: 'Work Request Volume Trend' }),
      chartContainer
    ]);
  },

  // ─── Task Completion Rate ──────────────────────────────────────────────
  renderTaskCompletion(entities) {
    const wrs = DB.getAll('workRequests').filter(wr => entities.includes(wr.entity?.toUpperCase?.()));
    const wrIds = new Set(wrs.map(wr => wr.id));
    const tasks = DB.getAll('tasks').filter(t => wrIds.has(t.workRequestId));
    const completedTasks = tasks.filter(t => t.status === 'Completed');

    let avgDays = 0;
    if (completedTasks.length > 0) {
      const totalDays = completedTasks.reduce((sum, t) => {
        return sum + this.daysBetween(t.createdAt, t.updatedAt);
      }, 0);
      avgDays = Math.round(totalDays / completedTasks.length);
    }

    const today = this.today();
    const overdueTasks = tasks.filter(t => {
      return t.dueDate < today && t.status !== 'Completed' && t.status !== 'Cancelled';
    });

    let overdueSection;
    if (overdueTasks.length === 0) {
      overdueSection = renderEmptyState('No overdue tasks', null, { variant: 'compact' });
    } else {
      const rows = overdueTasks.map(t => {
        const assignee = t.assigneeName
          ? t.assigneeName
          : (t.assigneeId || t.assignedTo)
            ? (DB.getById('users', t.assigneeId || t.assignedTo)?.name || t.assigneeId || t.assignedTo)
            : 'Unassigned';
        return el('tr', {}, [
          el('td', { text: t.title }),
          el('td', { text: formatDate(t.dueDate) }),
          el('td', { text: assignee }),
          el('td', { text: t.status })
        ]);
      });
      overdueSection = el('table', { class: 'report-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Task' }),
            el('th', { text: 'Due Date' }),
            el('th', { text: 'Assignee' }),
            el('th', { text: 'Status' })
          ])
        ]),
        el('tbody', {}, rows)
      ]);
    }

    return el('div', { class: 'bento-item bento-third report-card' }, [
      el('h2', { text: 'Task Completion Rate' }),
      el('div', { class: 'report-stat' }, [
        el('span', { text: String(avgDays) }),
        el('span', { class: 'report-stat-label', text: ' avg days to complete' })
      ]),
      el('h3', { text: 'Overdue Tasks (' + overdueTasks.length + ')' }),
      overdueSection
    ]);
  },

  // ─── Billing Summary ─────────────────────────────────────────────────
  renderBillingSummary(entities) {
    const invoices = this.filterByEntity(DB.getAll('invoices'), entities)
      .filter(inv => inv.status !== 'Cancelled');

    const byEntity = {};
    entities.forEach(e => {
      byEntity[e] = { pf: 0, govt: 0, outstanding: 0 };
    });

    invoices.forEach(inv => {
      const e = inv.entity.toUpperCase();
      if (!byEntity[e]) return;
      inv.lineItems.forEach(li => {
        if (li.type === 'PF' || li.type === 'Professional Fee') byEntity[e].pf += li.amount;
        else if (li.type === 'GovtFee' || li.type === 'Government Fee') byEntity[e].govt += li.amount;
      });
      if (['Sent', 'Partially Paid', 'Overdue'].includes(inv.status)) {
        const paid = inv.paidAmount ?? inv.amountPaid ?? 0;
        byEntity[e].outstanding += (inv.total - paid);
      }
    });

    const rows = entities.map(e => {
      const data = byEntity[e];
      return el('tr', {}, [
        el('td', { text: e }),
        el('td', { class: 'num', text: formatPHP(data.pf) }),
        el('td', { class: 'num', text: formatPHP(data.govt) }),
        el('td', { class: 'num', text: formatPHP(data.outstanding) })
      ]);
    });

    return el('div', { class: 'bento-item bento-half report-card' }, [
      el('h2', { text: 'Billing Summary' }),
      el('table', { class: 'report-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Entity' }),
            el('th', { text: 'Professional Fee Billed' }),
            el('th', { text: "Gov't Fees" }),
            el('th', { text: 'Outstanding' })
          ])
        ]),
        el('tbody', {}, rows)
      ])
    ]);
  },

  // ─── Disbursement Report ─────────────────────────────────────────────
  renderDisbursementReport(entities) {
    const disbursements = this.filterByEntity(DB.getAll('disbursements'), entities)
      .filter(d => d.status === 'Released');

    const byEmployee = {};
    let firmFund = 0;
    let clientFund = 0;

    disbursements.forEach(d => {
      const source = d.fundSource || (d.type === 'ClientFunded' ? 'Client Fund' : 'Firm Fund');
      if (source === 'Firm Fund') firmFund += d.amount;
      else if (source === 'Client Fund') clientFund += d.amount;

      const empId = d.employeeId || d.requestedBy || 'unknown';
      if (!byEmployee[empId]) {
        const user = DB.getById('users', empId);
        byEmployee[empId] = { name: user?.name || empId, total: 0, count: 0 };
      }
      byEmployee[empId].total += d.amount;
      byEmployee[empId].count += 1;
    });

    const fundSplit = el('div', { class: 'fund-split' }, [
      el('div', { class: 'fund-box' }, [
        el('div', { class: 'fund-label', text: 'Firm Fund' }),
        el('div', { class: 'fund-value', text: formatPHP(firmFund) })
      ]),
      el('div', { class: 'fund-box' }, [
        el('div', { class: 'fund-label', text: 'Client Fund' }),
        el('div', { class: 'fund-value', text: formatPHP(clientFund) })
      ])
    ]);

    let employeeTable;
    const empEntries = Object.values(byEmployee);
    if (empEntries.length === 0) {
      employeeTable = renderEmptyState('No released disbursements', null, { variant: 'compact' });
    } else {
      const rows = empEntries.map(emp =>
        el('tr', {}, [
          el('td', { text: emp.name }),
          el('td', { class: 'num', text: String(emp.count) }),
          el('td', { class: 'num', text: formatPHP(emp.total) })
        ])
      );
      employeeTable = el('table', { class: 'report-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Employee' }),
            el('th', { text: 'Count' }),
            el('th', { text: 'Total' })
          ])
        ]),
        el('tbody', {}, rows)
      ]);
    }

    return el('div', { class: 'bento-item bento-half report-card' }, [
      el('h2', { text: 'Disbursement Report' }),
      fundSplit,
      el('h3', { text: 'By Employee' }),
      employeeTable
    ]);
  },

  // ─── Entity P&L Snapshot ───────────────────────────────────────────────
  renderEntityPL(entities) {
    const invoices = DB.getAll('invoices').filter(inv => inv.status === 'Paid');
    const disbursements = DB.getAll('disbursements').filter(d => {
      const source = d.fundSource || (d.type === 'ClientFunded' ? 'Client Fund' : 'Firm Fund');
      return source === 'Firm Fund';
    });

    const byEntity = {};
    entities.forEach(e => {
      byEntity[e] = { revenue: 0, expenses: 0 };
    });

    invoices.forEach(inv => {
      const e = inv.entity.toUpperCase();
      if (!byEntity[e]) return;
      inv.lineItems.forEach(li => {
        if (li.type === 'PF' || li.type === 'Professional Fee') byEntity[e].revenue += li.amount;
      });
    });

    disbursements.forEach(d => {
      const e = d.entity.toUpperCase();
      if (!byEntity[e]) return;
      byEntity[e].expenses += d.amount;
    });

    const cards = entities.map(e => {
      const data = byEntity[e];
      const pl = data.revenue - data.expenses;
      const isPositive = pl >= 0;
      return el('div', { class: 'pl-card ' + e.toLowerCase() }, [
        el('h3', { text: e }),
        el('div', { class: 'pl-row' }, [
          el('span', { class: 'pl-label', text: 'Revenue' }),
          el('span', { class: 'pl-value', text: formatPHP(data.revenue) })
        ]),
        el('div', { class: 'pl-row' }, [
          el('span', { class: 'pl-label', text: 'Expenses' }),
          el('span', { class: 'pl-value', text: formatPHP(data.expenses) })
        ]),
        el('div', { class: 'pl-divider' }),
        el('div', { class: 'pl-row pl-total' }, [
          el('span', { class: 'pl-label', text: 'P&L' }),
          el('span', {
            class: 'pl-value ' + (isPositive ? 'positive' : 'negative'),
            text: formatPHP(pl)
          })
        ])
      ]);
    });

    return el('div', { class: 'bento-item bento-full report-card' }, [
      el('h2', { text: 'Entity P&L Snapshot' }),
      el('div', { class: 'pl-grid' }, cards)
    ]);
  }
};
