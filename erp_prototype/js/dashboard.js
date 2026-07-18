/**
 * Dashboard Module — Firm Overview
 * Redesigned for 2026 with a premium calendar hub, KPI metric strip, Bento layout,
 * natural language command bar, timezone intelligence, and hybrid work coordination buffers.
 *
 * Migrated from localStorage (DB.*) to the Node.js backend API.
 * - KPI widgets use window.apiClient.reports.analytics().
 * - Calendar events are sourced from window.apiClient.workRequests.list()
 *   and window.apiClient.disbursements.list(), filtered by due date.
 * - Task color-coding / overdue counts use window.apiClient.workRequests.listTasks().
 * - User and client name lookups use window.apiClient.userCache / clientCache.
 */

const Dashboard = {
  selectedDay: null,
  expandedItemId: null,
  calView: 'week',
  calTimezone: 'local', // 'local' (GMT+8) | 'utc' | 'est' (GMT-5)
  isLoading: false,
  commandFeedback: null,

  // API data cache populated by ensureData().
  _dataCache: null,
  _dataPromise: null,

  fmtDate(d) {
    if (!d) return '';
    if (typeof d === 'string') d = new Date(d + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  todayStr() {
    return this.fmtDate(new Date());
  },

  init() {
    this.selectedDay = null;
    this.expandedItemId = null;
    this.calView = 'week';
    this.calTimezone = 'local';
    this.isLoading = false;
    this.commandFeedback = null;
    this._dataCache = null;
    this._dataPromise = null;
  },

  async render() {
    await this.ensureData();
    if (Auth.activeEntity === 'ALL') {
      return this.renderConsolidated();
    }
    return this.renderEntityScoped();
  },

  renderConsolidated() {
    const ata = this.getEntityMetrics('ATA');
    const lta = this.getEntityMetrics('LTA');

    const container = el('div', { class: 'page animate-fade-in' });

    // 1. Premium welcome header banner
    container.appendChild(this.renderWelcomeHeader('Firm Overview'));

    // Time-log prompt banner (if applicable)
    const timeLogPrompt = this.renderTimeLogPrompt();
    if (timeLogPrompt) container.appendChild(timeLogPrompt);

    // 2. Glassmorphic KPI Metric Strip (Horizontal)
    const kpiStrip = el('div', { class: 'kpi-strip' });
    kpiStrip.appendChild(this.premiumKpiCard('ATA Revenue', ata.revenue, 'ata', '+15%', '#2563eb'));
    kpiStrip.appendChild(this.premiumKpiCard('LTA Revenue', lta.revenue, 'lta', '+8%', '#10b981'));
    kpiStrip.appendChild(this.premiumKpiCard('Total Outstanding', ata.outstanding + lta.outstanding, 'outstanding', '-5%', '#f59e0b'));
    kpiStrip.appendChild(this.premiumKpiCard('Overdue Tasks', ata.overdue + lta.overdue, 'tasks', '+2%', '#ef4444'));
    container.appendChild(kpiStrip);

    // 3. Central Calendar Bento Card
    const bento = el('div', { class: 'bento-grid' });
    const calendarCard = this.renderCalendarCard();
    calendarCard.className = 'bento-item bento-full dashboard-calendar-card';
    this.calendarCardRef = calendarCard;
    bento.appendChild(calendarCard);
    container.appendChild(bento);

    // 4. Comparison Table (at the very bottom)
    const tableSection = el('div', { class: 'bento-item bento-full', style: 'padding: 0; background: transparent; box-shadow: none;' });
    tableSection.appendChild(this.renderComparisonTable(ata, lta));
    container.appendChild(tableSection);

    return container;
  },

  renderEntityScoped() {
    const metrics = this.getEntityMetrics(Auth.activeEntity);
    const container = el('div', { class: 'page animate-fade-in' });

    // 1. Premium welcome header banner
    container.appendChild(this.renderWelcomeHeader(Auth.activeEntity + ' Overview'));

    const timeLogPrompt = this.renderTimeLogPrompt();
    if (timeLogPrompt) container.appendChild(timeLogPrompt);

    // 2. Glassmorphic KPI Metric Strip
    const kpiStrip = el('div', { class: 'kpi-strip' });
    const isAta = Auth.activeEntity === 'ATA';
    const accent = isAta ? '#2563eb' : '#10b981';

    kpiStrip.appendChild(this.premiumKpiCard('Active Work Requests', metrics.activeWR, 'active', '+3%', '#8b5cf6'));
    kpiStrip.appendChild(this.premiumKpiCard('Revenue (Paid)', metrics.revenue, isAta ? 'ata' : 'lta', '+11%', accent));
    kpiStrip.appendChild(this.premiumKpiCard('Outstanding', metrics.outstanding, 'outstanding', '-2%', '#f59e0b'));
    kpiStrip.appendChild(this.premiumKpiCard('Overdue Tasks', metrics.overdue, 'tasks', '+1%', '#ef4444'));
    container.appendChild(kpiStrip);

    // 3. Central Calendar Bento Card (nothing below it for entity scoped)
    const bento = el('div', { class: 'bento-grid' });
    const calendarCard = this.renderCalendarCard();
    calendarCard.className = 'bento-item bento-full dashboard-calendar-card';
    this.calendarCardRef = calendarCard;
    bento.appendChild(calendarCard);
    container.appendChild(bento);

    return container;
  },

  renderWelcomeHeader(title) {
    const banner = el('div', { class: 'dashboard-welcome-banner' });
    const left = el('div', { class: 'welcome-info' });

    const hours = new Date().getHours();
    let salutation = 'Good day';
    if (hours < 12) salutation = 'Good morning';
    else if (hours < 17) salutation = 'Good afternoon';
    else salutation = 'Good evening';

    left.appendChild(el('h2', { class: 'welcome-title', text: `${salutation}, ${Auth.user?.name || 'User'}!` }));

    const contextText = Auth.activeEntity === 'ALL'
      ? 'Viewing consolidated overview for ATA Accounting & LTA Accounting.'
      : `Viewing dashboard for ${Auth.activeEntity} Accounting Firm.`;

    left.appendChild(el('p', { class: 'welcome-subtitle', text: contextText }));

    const statusWrap = el('div', { class: 'welcome-status' });
    statusWrap.appendChild(el('span', { class: 'pulse-dot' }));
    statusWrap.appendChild(el('span', { text: `System Active & Synced • 2026 ERP Hub` }));
    left.appendChild(statusWrap);

    banner.appendChild(left);
    return banner;
  },

  premiumKpiCard(label, value, type, trend, accentColor) {
    const card = el('div', { class: 'premium-kpi-card', style: `--card-accent: ${accentColor || 'var(--color-primary)'};` });

    const top = el('div', { class: 'kpi-top' });
    let iconChar = '∑';
    let iconStyle = '';
    if (type === 'ata') {
      iconChar = 'A';
      iconStyle = 'background: rgba(37, 99, 235, 0.1); color: var(--color-primary);';
    } else if (type === 'lta') {
      iconChar = 'L';
      iconStyle = 'background: rgba(16, 185, 129, 0.1); color: var(--color-lta);';
    } else if (type === 'outstanding') {
      iconChar = '💸';
      iconStyle = 'background: rgba(245, 158, 11, 0.1); color: var(--color-warning);';
    } else if (type === 'tasks') {
      iconChar = '📋';
      iconStyle = 'background: rgba(239, 68, 68, 0.1); color: var(--color-danger);';
    } else if (type === 'active') {
      iconChar = '⚡';
      iconStyle = 'background: rgba(139, 92, 246, 0.1); color: #8b5cf6;';
    }

    const iconWrap = el('div', { class: 'kpi-icon-wrap', style: iconStyle, text: iconChar });
    top.appendChild(iconWrap);

    if (trend) {
      const isPos = trend.startsWith('+');
      const trendClass = `kpi-trend-pill ${isPos ? 'positive' : 'negative'}`;
      top.appendChild(el('span', { class: trendClass, text: trend }));
    }
    card.appendChild(top);

    const main = el('div', { class: 'kpi-main' });
    main.appendChild(el('span', { class: 'kpi-title', text: label }));

    const displayVal = typeof value === 'number' && value > 100
      ? formatPHP(value)
      : String(value);
    main.appendChild(el('span', { class: 'kpi-big-num', text: displayVal }));

    card.appendChild(main);
    return card;
  },

  renderTimeLogPrompt() {
    const now = new Date();
    if (now.getHours() < 17) return null;

    const myTasks = (this._dataCache?.tasks || []).filter(t => t.assigneeId === Auth.user?.id && t.status !== 'Completed');
    if (myTasks.length === 0) return null;

    const todayStr = this.todayStr();
    const tasksNeedingLogs = myTasks.filter(t => !t.timeLogs || !t.timeLogs.some(log => log.date === todayStr));

    if (tasksNeedingLogs.length === 0) return null;

    const banner = el('div', {
      class: 'alert-banner',
      style: 'background: var(--color-bg-muted); border: 1px solid var(--color-warning); color: var(--color-text); padding: 12px 16px; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);'
    });

    const left = el('div', { style: 'display: flex; align-items: center; gap: 12px;' });
    left.innerHTML = `<span style="font-size: 1.25rem;">⏰</span> <div><strong>End of Day Reminder:</strong> You have ${tasksNeedingLogs.length} incomplete assigned task(s) but haven't submitted your daily time log for them yet. Please log your time before finishing your day.</div>`;
    banner.appendChild(left);

    const right = el('button', { class: 'btn btn-primary btn-sm', text: 'Go to Tasks' });
    right.onclick = () => {
      location.hash = '#operations';
      App.handleRoute();
    };
    banner.appendChild(right);

    return banner;
  },

  getEntityMetrics(entity) {
    const cache = this._dataCache || {};
    const analytics = cache.analyticsByEntity?.[entity] || {};
    const wrs = (cache.workRequests || []).filter(r => r.entity === entity);
    const tasks = (cache.tasks || []).filter(t => {
      const wr = (cache.workRequests || []).find(r => r.id === t.workRequestId);
      return wr && wr.entity === entity;
    });

    return {
      activeWR: wrs.filter(r => r.status !== 'Completed' && r.status !== 'Cancelled').length,
      revenue: analytics.invoices?.totalCollected || 0,
      outstanding: analytics.invoices?.totalOutstanding || 0,
      overdue: tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled' && t.dueDate && new Date(t.dueDate) < new Date()).length
    };
  },

  renderComparisonTable(ata, lta) {
    const section = el('div', { class: 'entity-comparison card', style: 'margin-bottom: 0;' });
    const h2 = el('h2', { class: 'card-title' }, ['Entity Comparison']);
    section.appendChild(h2);
    const table = el('table', { class: 'data-table' });

    const thead = el('thead');
    const headerRow = el('tr');
    headerRow.appendChild(el('th', {}, ['Metric']));
    headerRow.appendChild(el('th', {}, ['ATA']));
    headerRow.appendChild(el('th', {}, ['LTA']));
    headerRow.appendChild(el('th', {}, ['Total']));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    const rows = [
      { label: 'Active Work Requests', ata: ata.activeWR, lta: lta.activeWR, isCurrency: false },
      { label: 'Revenue (Paid)', ata: ata.revenue, lta: lta.revenue, isCurrency: true },
      { label: 'Outstanding', ata: ata.outstanding, lta: lta.outstanding, isCurrency: true },
      { label: 'Overdue Tasks', ata: ata.overdue, lta: lta.overdue, isCurrency: false }
    ];
    rows.forEach(row => {
      const tr = el('tr');
      tr.appendChild(el('td', {}, [row.label]));
      tr.appendChild(el('td', {}, [row.isCurrency ? formatPHP(row.ata) : String(row.ata)]));
      tr.appendChild(el('td', {}, [row.isCurrency ? formatPHP(row.lta) : String(row.lta)]));
      tr.appendChild(el('td', {}, [row.isCurrency ? formatPHP(row.ata + row.lta) : String(row.ata + row.lta)]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  },

  renderCalendarCard(container) {
    if (!container) {
      container = el('div', { class: 'bento-item bento-full dashboard-calendar-card' });
    } else {
      container.innerHTML = '';
    }

    if (this.calMonth === undefined || this.calYear === undefined) {
      const todayDate = new Date();
      this.calMonth = todayDate.getMonth();
      this.calYear = todayDate.getFullYear();
    }

    if (!this.selectedDay) {
      const now = new Date();
      this.selectedDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    if (this.calView === undefined) this.calView = 'week';
    if (this.calTimezone === undefined) this.calTimezone = 'local';

    const events = this.getCalendarEvents();

    // Left Calendar Main View
    const mainView = el('div', { class: 'calendar-main-view' });

    // Calendar Header
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const header = el('div', { class: 'calendar-header' });

    const headerLeft = el('div', { class: 'calendar-header-left' });

    let headerText = `${months[this.calMonth]} ${this.calYear}`;
    let isCurrentlyToday = true;

    if (this.calView !== 'month' && this.selectedDay) {
      const d = new Date(this.selectedDay);
      headerText = `${months[d.getMonth()]} ${d.getFullYear()}`;

      const todayDate = new Date();
      const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;

      if (this.calView === 'day') {
        isCurrentlyToday = this.selectedDay === todayStr;
      } else if (this.calView === 'week' || this.calView === 'timeline') {
        const selectedDate = new Date(this.selectedDay);
        const dayOfWeek = selectedDate.getDay();
        const startOfWeek = new Date(selectedDate);
        startOfWeek.setDate(selectedDate.getDate() - dayOfWeek);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        const todayTime = todayDate.getTime();
        isCurrentlyToday = todayTime >= startOfWeek.getTime() && todayTime <= endOfWeek.getTime() + 86400000;
      }
    } else if (this.calView === 'month') {
        const todayDate = new Date();
        isCurrentlyToday = this.calMonth === todayDate.getMonth() && this.calYear === todayDate.getFullYear();
    }

    headerLeft.appendChild(el('h3', { class: 'calendar-month-year', text: headerText }));

    let btnText = 'Today';
    if (!isCurrentlyToday && this.selectedDay && this.calView !== 'month') {
        const d = new Date(this.selectedDay);
        btnText = `${months[d.getMonth()].substring(0, 3)} ${d.getDate()}`;
    }

    const todayBtn = el('button', { class: 'calendar-today-btn', text: btnText });
    todayBtn.onclick = (e) => {
      e.stopPropagation();
      const now = new Date();
      this.calMonth = now.getMonth();
      this.calYear = now.getFullYear();
      this.selectedDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      this.refreshCalendarCard();
    };
    headerLeft.appendChild(todayBtn);

    // Nav arrows
    const navs = el('div', { class: 'calendar-nav-arrows' });
    const prevBtn = el('button', { class: 'calendar-arrow-btn', text: '‹' });
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.calView === 'month') {
        this.calMonth--;
        if (this.calMonth < 0) {
          this.calMonth = 11;
          this.calYear--;
        }
      } else {
        const d = this.selectedDay ? new Date(this.selectedDay) : new Date();
        d.setDate(d.getDate() - 1);
        this.selectedDay = this.fmtDate(d);
        this.calMonth = d.getMonth();
        this.calYear = d.getFullYear();
      }
      this.refreshCalendarCard();
    };

    const nextBtn = el('button', { class: 'calendar-arrow-btn', text: '›' });
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.calView === 'month') {
        this.calMonth++;
        if (this.calMonth > 11) {
          this.calMonth = 0;
          this.calYear++;
        }
      } else {
        const d = this.selectedDay ? new Date(this.selectedDay) : new Date();
        d.setDate(d.getDate() + 1);
        this.selectedDay = this.fmtDate(d);
        this.calMonth = d.getMonth();
        this.calYear = d.getFullYear();
      }
      this.refreshCalendarCard();
    };

    navs.appendChild(prevBtn);
    navs.appendChild(nextBtn);
    headerLeft.appendChild(navs);

    header.appendChild(headerLeft);

    // Right View Toggle
    const headerRight = el('div', { class: 'calendar-header-right' });
    const viewToggle = el('div', { class: 'calendar-view-toggle' });
    ['Day', 'Week', 'Month', 'Timeline'].forEach(v => {
      const mode = v.toLowerCase();
      const btn = el('button', {
        class: `view-btn ${this.calView === mode ? 'active' : ''}`,
        text: v
      });
      btn.onclick = (e) => {
        e.stopPropagation();
        this.calView = mode;
        this.isLoading = true;
        this.refreshCalendarCard();
        setTimeout(() => {
          this.isLoading = false;
          this.refreshCalendarCard();
        }, 200);
      };
      viewToggle.appendChild(btn);
    });
    headerRight.appendChild(viewToggle);
    header.appendChild(headerRight);

    mainView.appendChild(header);



    // Grid Container or Timeline Container
    const gridClass = this.calView === 'week' ? 'calendar-week-grid' : (this.calView === 'day' ? 'calendar-day-grid' : 'calendar-grid');
    const grid = el('div', { class: gridClass });

    if (this.isLoading) {
      this.renderSkeletonGrid(grid);
      mainView.appendChild(grid);
    } else {
      if (this.calView === 'month') {
        this.renderMonthGrid(grid, events);
        mainView.appendChild(grid);
      } else if (this.calView === 'week') {
        this.renderWeekGrid(grid, events);
        mainView.appendChild(grid);
      } else if (this.calView === 'day') {
        this.renderDayGrid(grid, events);
        mainView.appendChild(grid);
      } else if (this.calView === 'timeline') {
        this.renderTimelineView(mainView, events);
      }
    }

    container.appendChild(mainView);

    // Right Sidebar (Progressive disclosure details)
    const sidebar = el('div', { class: 'calendar-sidebar' });
    this.renderSidebarContent(sidebar, events);
    container.appendChild(sidebar);

    // Auto-scroll to current time for week/day views
    if (!this.isLoading && (this.calView === 'week' || this.calView === 'day')) {
      setTimeout(() => {
        if (this.calendarCardRef) {
          const gridEl = this.calendarCardRef.querySelector('.calendar-week-grid, .calendar-day-grid');
          if (gridEl) {
             const nowHour = new Date().getHours();
             let targetIdx = nowHour - 9 + 1;
             if (targetIdx < 0) targetIdx = 0;
             gridEl.scrollTo({ top: targetIdx * 71, behavior: 'smooth' });
          }
        }
      }, 50);
    }

    return container;
  },

  calMonthView() {
    this.calView = 'month';
  },

  async parseCommand(text) {
    const input = text.trim();
    if (!input) return null;

    let type = null;
    if (/\b(wr|work\s*request|task)\b/i.test(input)) {
      type = 'wr';
    } else if (/\b(db|disbursement|disburse|pay|billing)\b/i.test(input)) {
      type = 'db';
    }

    if (!type) {
      return { success: false, message: "Type unrecognized. Please prefix with 'wr' (Work Request) or 'db' (Disbursement)." };
    }

    let entity = 'ATA';
    if (/\blta\b/i.test(input)) {
      entity = 'LTA';
    } else if (/\bata\b/i.test(input)) {
      entity = 'ATA';
    } else if (Auth.activeEntity && Auth.activeEntity !== 'ALL') {
      entity = Auth.activeEntity;
    }

    let dateStr = this.todayStr();
    const dateMatch = input.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (dateMatch) {
      dateStr = dateMatch[0];
    } else if (/\btomorrow\b/i.test(input)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateStr = this.fmtDate(tomorrow);
    } else if (/\bnext\s+week\b/i.test(input)) {
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      dateStr = this.fmtDate(nextWeek);
    } else if (/\bnext\s+monday\b/i.test(input)) {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? 1 : 8);
      const nextMonday = new Date(d.setDate(diff));
      dateStr = this.fmtDate(nextMonday);
    }

    let amount = 5000;
    const amountMatch = input.match(/\b(?:php\s*|p\s*)?(\d+(?:\.\d+)?)\b/i);
    if (amountMatch) {
      const val = parseFloat(amountMatch[1]);
      if (val > 100 && val !== 2026) {
        amount = val;
      }
    }

    let cleanText = input
      .replace(/\b(wr|work\s*request|task|db|disbursement|disburse|pay|billing)\b/ig, '')
      .replace(/\b(ata|lta)\b/ig, '')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/\b(tomorrow|next\s+week|next\s+monday|on|for|at)\b/ig, '')
      .replace(/\b(?:php\s*|p\s*)?\d+(?:\.\d+)?\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) {
      cleanText = type === 'wr' ? 'New Work Request via AI' : 'Office Expenses';
    }

    if (type === 'wr') {
      await window.apiClient.clientCache.ensure();
      const firstClient = (window.apiClient.clientCache._clients || []).find(c => (c.entity || '').toUpperCase() === entity);
      const newWr = {
        title: cleanText,
        description: 'Scheduled via AI Command: "' + input + '"',
        clientId: firstClient?.id,
        entity: entity,
        status: 'In Progress', // Legacy prototype used 'Processing'; backend operations status is 'In Progress'.
        requestedBy: Auth.user?.id,
        assignedTo: Auth.user?.id,
        dueDate: dateStr
      };
      try {
        await window.apiClient.workRequests.create(newWr);
        this._dataCache = null; // invalidate so the new item appears on next render
        return { success: true, message: `Scheduled Work Request: "${cleanText}" for ${entity} on ${dateStr}` };
      } catch (e) {
        return { success: false, message: e.message || 'Failed to create work request.' };
      }
    } else {
      // Backend disbursement create schema does not accept status; creation yields 'Draft'.
      // Submit immediately so it becomes 'Pending' and appears on the calendar as before.
      const newDb = {
        description: cleanText,
        category: 'Miscellaneous', // Legacy 'Office & Admin' is not in backend schema.
        amount: amount,
        fundSource: 'Firm Fund', // Legacy 'Petty Cash' is not in backend schema (allowed: Firm Fund, Client Fund).
        dueDate: dateStr
      };
      try {
        const res = await window.apiClient.disbursements.create(newDb);
        if (res?.data?.id) {
          await window.apiClient.disbursements.submit(res.data.id);
        }
        this._dataCache = null;
        return { success: true, message: `Scheduled Disbursement: "${cleanText}" (PHP ${amount.toLocaleString()}) for ${entity} on ${dateStr}` };
      } catch (e) {
        return { success: false, message: e.message || 'Failed to create disbursement.' };
      }
    }
  },

  renderSkeletonGrid(grid) {
    grid.innerHTML = '';
    const itemsCount = this.calView === 'month' ? 35 : (this.calView === 'week' ? 21 : 5);
    for (let i = 0; i < itemsCount; i++) {
      const cell = el('div', { class: 'calendar-cell', style: 'opacity: 0.6; min-height: 80px;' });
      cell.appendChild(el('div', { class: 'skeleton-cell' }));
      grid.appendChild(cell);
    }
  },

  renderTimelineView(container, events) {
    const timeline = el('div', { class: 'timeline-container' });
    const dates = Object.keys(events).sort();

    if (dates.length === 0) {
      timeline.appendChild(el('div', { class: 'empty-state', text: 'No scheduled events found.' }));
      container.appendChild(timeline);
      return;
    }

    dates.forEach(dateStr => {
      const dayEvents = events[dateStr] || [];
      if (dayEvents.length === 0) return;

      const group = el('div', { class: 'timeline-date-group' });
      const header = el('div', { class: 'timeline-date-header' });
      header.appendChild(el('span', { text: formatDate(dateStr) }));

      const isToday = dateStr === this.todayStr();
      if (isToday) {
        header.appendChild(el('span', { class: 'badge badge-primary', text: 'TODAY' }));
      }
      group.appendChild(header);

      const itemsContainer = el('div', { class: 'timeline-items' });

      dayEvents.forEach(ev => {
        const isCompleted = ev.type === 'wr' ? ev.data.status === 'Completed' : ev.data.status === 'Released';
        const card = el('div', { class: 'timeline-card' });

        const left = el('div', { class: 'timeline-card-left' });
        const typeIcon = ev.type === 'wr' ? '📋' : '💸';
        const bgStyle = ev.type === 'wr' ? 'background: rgba(139, 92, 246, 0.1); color: #8b5cf6;' : 'background: rgba(16, 185, 129, 0.1); color: var(--color-success);';

        const icon = el('div', { class: 'timeline-type-icon', style: bgStyle, text: typeIcon });
        left.appendChild(icon);

        const info = el('div', { class: 'timeline-card-info' });
        const titleText = ev.type === 'wr' ? ev.data.title : ev.data.description;
        const entityPrefix = ev.data.entity ? `[${ev.data.entity.toUpperCase()}] ` : '';
        info.appendChild(el('span', { class: 'timeline-card-title', text: entityPrefix + titleText }));

        const client = ev.data.clientId ? window.apiClient.clientCache.getById(ev.data.clientId) : null;
        const clientName = client ? client.name : 'No client';

        const metaText = ev.type === 'wr'
          ? `Work Request • Client: ${clientName} • Status: ${ev.data.status}`
          : `Disbursement • Amount: ${formatPHP(ev.data.amount)} • Status: ${ev.data.status}`;

        info.appendChild(el('span', { class: 'timeline-card-meta', text: metaText }));
        left.appendChild(info);
        card.appendChild(left);

        const right = el('div', { class: 'timeline-card-right' });
        right.appendChild(el('span', { class: `badge ${isCompleted ? 'badge-success' : 'badge-info'}`, text: ev.data.status }));
        card.appendChild(right);

        card.onclick = (e) => {
          e.stopPropagation();
          this.selectedDay = dateStr;
          this.expandedItemId = ev.data.id;
          this.refreshCalendarCard();
        };

        itemsContainer.appendChild(card);
      });

      group.appendChild(itemsContainer);
      timeline.appendChild(group);
    });

    container.appendChild(timeline);
  },

  getAdjustedHourLabel(localHour, timezone) {
    let diff = 0;
    if (timezone === 'utc') diff = -8;
    else if (timezone === 'est') diff = -13;

    const adjHour = (localHour + 24 + diff) % 24;
    let label = '';
    if (adjHour === 0) label = '12 AM';
    else if (adjHour < 12) label = `${adjHour} AM`;
    else if (adjHour === 12) label = '12 PM';
    else label = `${adjHour - 12} PM`;

    const tzSuffix = timezone === 'local' ? '' : ` ${timezone.toUpperCase()}`;
    return label + tzSuffix;
  },

  renderWeekGrid(grid, events) {
    const baseDate = new Date(this.calYear, this.calMonth, parseInt(this.selectedDay ? this.selectedDay.split('-')[2] : new Date().getDate()));
    const startOfWeek = new Date(baseDate);

    // Header Row
    grid.appendChild(el('div', { class: 'week-time-label empty' }));

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      weekDates.push(d);

      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isToday = dateStr === this.todayStr();

      const dayHeader = el('div', { class: `week-day-header ${isToday ? 'today' : ''}` });
      dayHeader.innerHTML = `<span class="day-name">${days[d.getDay()]}</span><span class="day-num">${String(d.getDate()).padStart(2, '0')}</span>`;

      if (isToday) {
          const now = new Date();
          const nowHour = now.getHours();
          const nowMin = now.getMinutes();
          const percent = ((nowHour * 60 + nowMin) / (24 * 60)) * 100;

          const timeBubble = el('div', {
            class: 'week-vertical-time-bubble',
            text: `${String(nowHour).padStart(2, '0')}:${String(nowMin).padStart(2, '0')}`,
            style: `left: ${percent}%;`
          });
          dayHeader.appendChild(timeBubble);

          const lineWrap = el('div', { class: 'week-vertical-time-line-wrap', style: `left: ${percent}%;` });
          const line = el('div', { class: 'week-vertical-time-line' });
          lineWrap.appendChild(line);
          dayHeader.appendChild(lineWrap);
      }
      grid.appendChild(dayHeader);
    }

    // Time Rows
    const baseHourSlots = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    grid.appendChild(el('div', { class: 'week-time-label', text: 'All Day' }));
    for (let i = 0; i < 7; i++) {
      grid.appendChild(el('div', { class: 'week-cell', 'data-date': this.fmtDate(weekDates[i]) }));
    }

    baseHourSlots.forEach((localHour) => {
      const nowHour = new Date().getHours();
      const isCurrentHour = (localHour === nowHour);
      const rowClass = isCurrentHour ? 'week-time-label current-hour' : 'week-time-label';

      // Adjusted timezone label
      const timeStr = this.getAdjustedHourLabel(localHour, this.calTimezone);
      grid.appendChild(el('div', { class: rowClass, text: timeStr }));

      for (let i = 0; i < 7; i++) {
        const d = weekDates[i];
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const isToday = dateStr === this.todayStr();
        const cellClass = `week-cell ${isCurrentHour && isToday ? 'current-hour-cell' : ''}`;
        const cell = el('div', { class: cellClass, 'data-date': dateStr });

        cell.onclick = (e) => {
            e.stopPropagation();
            this.selectedDay = this.selectedDay === dateStr ? null : dateStr;
            this.expandedItemId = null;
            this.refreshCalendarCard();
        };

        grid.appendChild(cell);
      }
    });

    // --- Event Overlay Layer (Spanning Bars) ---
    const overlayContainer = el('div', { class: 'week-events-overlay' });
    grid.appendChild(overlayContainer);

    const getEventSlot = (ev, totalDayEvents) => {
      let hash = 0;
      for(let k=0; k<ev.data.id.length; k++) hash += ev.data.id.charCodeAt(k);
      let evSlot = (hash % 8) + 1;
      return evSlot;
    };

    const slotMap = {};
    const placedEvents = new Set();

    weekDates.forEach((d, dayIdx) => {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayEvents = events[dateStr] || [];

      dayEvents.forEach(ev => {
        const key = `${ev.type}-${ev.data.id}`;
        if (placedEvents.has(key)) return;

        const evSlot = getEventSlot(ev, dayEvents.length);
        if (!slotMap[evSlot]) slotMap[evSlot] = [];

        let spanDays = 1;
        let next = new Date(d);
        while (spanDays < 7 - dayIdx) {
          next.setDate(next.getDate() + 1);
          const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
          if ((events[nextStr] || []).some(e => e.type === ev.type && e.data.id === ev.data.id)) {
            spanDays++;
          } else {
            break;
          }
        }

        slotMap[evSlot].push({ ev, dayIdx, spanDays, dateStr });
        placedEvents.add(key);
      });
    });

    const PILL_HEIGHT = 26;
    const PILL_GAP = 4;

    Object.keys(slotMap).forEach(slotIdx => {
      const eventsInSlot = slotMap[slotIdx];
      if (eventsInSlot.length === 0) return;

      eventsInSlot.sort((a, b) => a.dayIdx - b.dayIdx);
      const dayOccupancy = [0, 0, 0, 0, 0, 0, 0];

      eventsInSlot.forEach(({ ev, dayIdx, spanDays, dateStr }) => {
        let maxOcc = 0;
        for (let i = 0; i < spanDays; i++) {
          if (dayIdx + i < 7) {
            maxOcc = Math.max(maxOcc, dayOccupancy[dayIdx + i]);
          }
        }

        for (let i = 0; i < spanDays; i++) {
          if (dayIdx + i < 7) {
            dayOccupancy[dayIdx + i] = maxOcc + 1;
          }
        }

        const topOffset = maxOcc * (PILL_HEIGHT + PILL_GAP);
        const overlay = this.createWeekEventOverlay(ev, dayIdx, spanDays, parseInt(slotIdx), topOffset, dateStr);
        overlayContainer.appendChild(overlay);
      });
    });
  },

  renderDayGrid(grid, events) {
    const d = new Date(this.selectedDay);
    const dateStr = this.selectedDay;
    const isToday = dateStr === this.todayStr();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Header Row
    grid.appendChild(el('div', { class: 'week-time-label empty' }));

    const dayHeader = el('div', { class: `week-day-header ${isToday ? 'today' : ''}` });
    dayHeader.innerHTML = `<span class="day-name">${days[d.getDay()]}</span><span class="day-num">${String(d.getDate()).padStart(2, '0')}</span>`;

    if (isToday) {
        const now = new Date();
        const nowHour = now.getHours();
        const nowMin = now.getMinutes();
        const percent = ((nowHour * 60 + nowMin) / (24 * 60)) * 100;

        const timeBubble = el('div', {
          class: 'week-vertical-time-bubble',
          text: `${String(nowHour).padStart(2, '0')}:${String(nowMin).padStart(2, '0')}`,
          style: `left: ${percent}%;`
        });
        dayHeader.appendChild(timeBubble);

        const lineWrap = el('div', { class: 'week-vertical-time-line-wrap', style: `left: ${percent}%;` });
        const line = el('div', { class: 'week-vertical-time-line' });
        lineWrap.appendChild(line);
        dayHeader.appendChild(lineWrap);
    }
    grid.appendChild(dayHeader);

    // Time Rows
    const timeSlots = ['All Day', '09 AM', '10 AM', '11 AM', '12 PM', '01 PM', '02 PM', '03 PM', '04 PM', '05 PM'];

    timeSlots.forEach((time, slotIndex) => {
      const nowHour = new Date().getHours();
      const isCurrentHour = (slotIndex > 0 && (slotIndex + 8 === nowHour));
      const rowClass = isCurrentHour ? 'week-time-label current-hour' : 'week-time-label';

      // Time zone adjusted label
      const timeStr = slotIndex === 0 ? 'All Day' : this.getAdjustedHourLabel(slotIndex + 8, this.calTimezone);
      grid.appendChild(el('div', { class: rowClass, text: timeStr }));

      const cellClass = `week-cell ${isCurrentHour && isToday ? 'current-hour-cell' : ''}`;
      const cell = el('div', { class: cellClass, 'data-date': dateStr, 'data-slot': String(slotIndex) });

      cell.onclick = (e) => {
        e.stopPropagation();
        this.selectedDay = this.selectedDay === dateStr ? null : dateStr;
        this.expandedItemId = null;
        this.refreshCalendarCard();
      };

      grid.appendChild(cell);
    });

    // Render events inside cells
    const dayEvents = events[dateStr] || [];

    timeSlots.forEach((time, slotIndex) => {
      const cell = grid.querySelector(`.week-cell[data-date="${dateStr}"][data-slot="${slotIndex}"]`);
      if (!cell) return;

      const slotEvents = dayEvents.filter(ev => {
         let hash = 0;
         for(let k=0; k<ev.data.id.length; k++) hash += ev.data.id.charCodeAt(k);
         let evSlot = (hash % 9) + 1;
         if (slotIndex === 0 && dayEvents.length > 5) return true;
         if (slotIndex === 0 && dayEvents.length <= 5 && evSlot > 9) return true;
         return evSlot === slotIndex;
      });

      if (slotEvents.length > 0) {
          slotEvents.forEach(ev => {
              const isCompleted = ev.type === 'wr' ? ev.data.status === 'Completed' : ev.data.status === 'Released';

              let colorClass = 'bg-cyan-500';
              let avatarName = 'U';

              if (isCompleted) {
                  colorClass = 'bg-green-500';
              }

              if (ev.type === 'wr') {
                  if (!isCompleted) {
                      const wrTasks = this._getTasksForWorkRequest(ev.data.id);
                      const total = wrTasks.length;
                      if (total === 0) {
                         colorClass = 'bg-purple-500';
                      } else {
                         const comp = wrTasks.filter(t => t.status === 'Completed').length;
                         const pct = comp / total;
                         if (pct === 1) colorClass = 'bg-green-500';
                         else if (pct >= 0.5) colorClass = 'bg-blue-500';
                         else if (pct > 0) colorClass = 'bg-yellow-500';
                         else colorClass = 'bg-orange-500';
                      }
                      if (ev.data.status === 'Cancelled') colorClass = 'bg-orange-500';
                  }

                  if (ev.data.assignedTo) {
                      const u = window.apiClient.userCache.getById(ev.data.assignedTo);
                      if (u) avatarName = u.name;
                  }
              } else {
                  if (!isCompleted) {
                      const s = ev.data.status;
                      if (s === 'Approved') colorClass = 'bg-blue-500';
                      else if (s === 'Pending') colorClass = 'bg-yellow-500';
                      else if (s === 'Draft') colorClass = 'bg-purple-500';
                      else colorClass = 'bg-purple-500';
                  }

                  if (ev.data.requestedBy) {
                      const u = window.apiClient.userCache.getById(ev.data.requestedBy);
                      if (u) avatarName = u.name;
                  }
              }

              const badge = el('div', {
                class: `week-event-pill ${colorClass} ${isCompleted ? 'completed' : ''}`,
                title: ev.type === 'wr' ? `Work Request: ${ev.data.title}` : `Disbursement: ${ev.data.description}`
              });

              const avatarWrap = el('div', { class: 'week-event-avatars' });
              const img = el('img', { class: 'week-event-avatar', src: `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=random` });
              avatarWrap.appendChild(img);
              badge.appendChild(avatarWrap);

              const titleText = ev.type === 'wr' ? ev.data.title : ev.data.description;
              const entityPrefix = ev.data.entity ? `[${ev.data.entity.toUpperCase()}] ` : '';
              badge.appendChild(el('span', { class: 'week-event-title', text: entityPrefix + titleText }));
              badge.appendChild(el('span', { class: 'week-event-arrow', text: '›' }));

              badge.onclick = (e) => {
                e.stopPropagation();
                this.expandedItemId = ev.data.id;
                this.refreshCalendarCard();
              };

              cell.appendChild(badge);
          });
      }
    });
  },

  renderMonthGrid(grid, events) {
    // Day Headers
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
      grid.appendChild(el('div', { class: 'calendar-day-name', text: d }));
    });

    const firstDayIndex = new Date(this.calYear, this.calMonth, 1).getDay();
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    const prevMonthDays = new Date(this.calYear, this.calMonth, 0).getDate();

    const todayDate = new Date();
    const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;

    // Previous month cells
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const m = this.calMonth === 0 ? 11 : this.calMonth - 1;
      const y = this.calMonth === 0 ? this.calYear - 1 : this.calYear;
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      grid.appendChild(this.renderDayCell(day, dateStr, true, events[dateStr], todayStr, events));
    }

    // Current month cells
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      grid.appendChild(this.renderDayCell(i, dateStr, false, events[dateStr], todayStr, events));
    }

    // Next month cells
    const totalRendered = firstDayIndex + daysInMonth;
    const remaining = 42 - totalRendered;
    for (let i = 1; i <= remaining; i++) {
      const m = this.calMonth === 11 ? 0 : this.calMonth + 1;
      const y = this.calMonth === 11 ? this.calYear + 1 : this.calYear;
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      grid.appendChild(this.renderDayCell(i, dateStr, true, events[dateStr], todayStr, events));
    }

    // Month Event Overlays
    const overlayContainer = el('div', { class: 'month-events-overlay' });
    grid.appendChild(overlayContainer);

    const placedEvents = new Set();
    const rowOccupancy = {};

    for (let cellIdx = 0; cellIdx < 42; cellIdx++) {
      let dateStr;
      if (cellIdx < firstDayIndex) {
        const day = prevMonthDays - (firstDayIndex - 1 - cellIdx);
        const m = this.calMonth === 0 ? 11 : this.calMonth - 1;
        const y = this.calMonth === 0 ? this.calYear - 1 : this.calYear;
        dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      } else if (cellIdx < firstDayIndex + daysInMonth) {
        const day = cellIdx - firstDayIndex + 1;
        dateStr = `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      } else {
        const day = cellIdx - (firstDayIndex + daysInMonth) + 1;
        const m = this.calMonth === 11 ? 0 : this.calMonth + 1;
        const y = this.calMonth === 11 ? this.calYear + 1 : this.calYear;
        dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }

      const dayEvents = events[dateStr] || [];
      const rowIdx = Math.floor(cellIdx / 7);
      const dayIdx = cellIdx % 7;

      dayEvents.forEach(ev => {
        const key = `${ev.type}-${ev.data.id}`;
        if (placedEvents.has(key)) return;

        let spanDays = 1;
        let nextCellIdx = cellIdx + 1;
        while (spanDays < 7 - dayIdx && nextCellIdx < 42) {
          let nextDateStr;
          if (nextCellIdx < firstDayIndex) {
            const day = prevMonthDays - (firstDayIndex - 1 - nextCellIdx);
            const m = this.calMonth === 0 ? 11 : this.calMonth - 1;
            const y = this.calMonth === 0 ? this.calYear - 1 : this.calYear;
            nextDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          } else if (nextCellIdx < firstDayIndex + daysInMonth) {
            const day = nextCellIdx - firstDayIndex + 1;
            nextDateStr = `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          } else {
            const day = nextCellIdx - (firstDayIndex + daysInMonth) + 1;
            const m = this.calMonth === 11 ? 0 : this.calMonth + 1;
            const y = this.calMonth === 11 ? this.calYear + 1 : this.calYear;
            nextDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          }

          if ((events[nextDateStr] || []).some(e => e.type === ev.type && e.data.id === ev.data.id)) {
            spanDays++;
            nextCellIdx++;
          } else {
            break;
          }
        }

        if (spanDays > 1) {
          if (!rowOccupancy[rowIdx]) rowOccupancy[rowIdx] = [0, 0, 0, 0, 0, 0, 0];
          const occ = rowOccupancy[rowIdx];

          let maxOcc = 0;
          for (let i = 0; i < spanDays; i++) {
            if (dayIdx + i < 7) {
              maxOcc = Math.max(maxOcc, occ[dayIdx + i]);
            }
          }

          for (let i = 0; i < spanDays; i++) {
            if (dayIdx + i < 7) {
              occ[dayIdx + i] = maxOcc + 1;
            }
          }

          const overlay = this.createMonthEventOverlay(ev, dayIdx, spanDays, rowIdx, maxOcc, dateStr);
          overlayContainer.appendChild(overlay);
          placedEvents.add(key);
        }
      });
    }

    setTimeout(() => this.setupAutoScroll(grid), 50);
  },

  renderDayCell(dayNum, dateStr, isOtherMonth, dayEvents, todayStr, events) {
    const classes = ['calendar-cell'];
    if (isOtherMonth) classes.push('other-month');
    if (dateStr === todayStr) classes.push('today');
    if (this.selectedDay === dateStr) classes.push('selected-day');

    const cell = el('div', { class: classes.join(' '), 'data-date': dateStr });

    const numWrapper = el('div', { class: 'day-number-wrapper' });
    numWrapper.appendChild(el('span', { class: 'day-number', text: String(dayNum) }));
    cell.appendChild(numWrapper);

    const eventsContainer = el('div', { class: 'calendar-cell-events' });
    if (dayEvents && dayEvents.length > 0) {
      const isSingleDay = (ev) => {
        const span = this.getEventSpanClasses(ev, dateStr, events);
        return !span.includes('span-left') && !span.includes('span-right');
      };

      const wrs = dayEvents.filter(e => e.type === 'wr' && isSingleDay(e));
      const dbs = dayEvents.filter(e => e.type === 'db' && isSingleDay(e));

      const renderBadge = (ev) => {
        const isCompleted = ev.type === 'wr' ? ev.data.status === 'Completed' : ev.data.status === 'Released';

        let colorClass = 'bg-cyan-500';
        if (ev.type === 'wr') {
            const wrTasks = this._getTasksForWorkRequest(ev.data.id);
            const total = wrTasks.length;
            if (total === 0) {
               colorClass = 'bg-purple-500';
            } else {
               const comp = wrTasks.filter(t => t.status === 'Completed').length;
               const pct = comp / total;
               if (pct === 1) colorClass = 'bg-green-500';
               else if (pct >= 0.5) colorClass = 'bg-blue-500';
               else if (pct > 0) colorClass = 'bg-yellow-500';
               else colorClass = 'bg-orange-500';
            }
            if (ev.data.status === 'Cancelled') colorClass = 'bg-orange-500';
        } else {
            const s = ev.data.status;
            if (s === 'Released') colorClass = 'bg-green-500';
            else if (s === 'Approved') colorClass = 'bg-blue-500';
            else if (s === 'Pending') colorClass = 'bg-yellow-500';
            else colorClass = 'bg-purple-500';
        }

        const badge = el('div', {
          class: `calendar-event-badge ${ev.type}-badge ${isCompleted ? 'completed' : ''}`,
          title: ev.type === 'wr' ? `Work Request: ${ev.data.title}` : `Disbursement: ${ev.data.description}`,
          style: `border-left-color: transparent; background: transparent; padding:0; box-shadow:none;`
        });

        const pill = el('div', { class: `week-event-pill ${colorClass}`, style: 'margin-bottom:0; width:100%;' });

        const status = (ev.data.status || 'Draft').toLowerCase();
        const dot = el('span', { class: `status-dot status-${status.replace(/\s+/g, '-')}`, style: 'background:#fff; margin-right:4px;' });
        pill.appendChild(dot);

        const titleText = ev.type === 'wr' ? ev.data.title : ev.data.description;
        const entityPrefix = ev.data.entity ? `[${ev.data.entity.toUpperCase()}] ` : '';
        pill.appendChild(el('span', { class: 'week-event-title', style: 'color:#fff;', text: entityPrefix + titleText }));

        badge.appendChild(pill);

        badge.onclick = (e) => {
          e.stopPropagation();
          this.selectedDay = dateStr;
          this.expandedItemId = ev.data.id;
          this.refreshCalendarCard();
        };
        return badge;
      };

      if (wrs.length > 0) {
        const wrGroup = el('div', { class: 'cell-events-group' });
        wrs.slice(0, 2).forEach(ev => wrGroup.appendChild(renderBadge(ev)));
        eventsContainer.appendChild(wrGroup);
      }
      if (dbs.length > 0) {
        const dbGroup = el('div', { class: 'cell-events-group' });
        dbs.slice(0, 2).forEach(ev => dbGroup.appendChild(renderBadge(ev)));
        eventsContainer.appendChild(dbGroup);
      }

      if (dayEvents.length > 4) {
        eventsContainer.appendChild(el('div', { class: 'events-more', text: `+${dayEvents.length - 4} more` }));
      }
    }
    cell.appendChild(eventsContainer);

    cell.onclick = (e) => {
      e.stopPropagation();
      this.selectedDay = this.selectedDay === dateStr ? null : dateStr;
      this.expandedItemId = null;
      this.refreshCalendarCard();
    };

    return cell;
  },

  getCalendarEvents() {
    const cache = this._dataCache || {};
    const userEntities = (Auth.user?.entities || []).map(e => e.toUpperCase());
    const active = (Auth.activeEntity || '').toUpperCase();

    let wrs = (cache.workRequests || []).slice();
    let disbursements = (cache.disbursements || []).slice();

    // Filter by Entity Access
    if (active === 'ALL') {
      wrs = wrs.filter(wr => userEntities.includes((wr.entity || '').toUpperCase()));
      disbursements = disbursements.filter(d => userEntities.includes((d.entity || '').toUpperCase()));
    } else {
      wrs = wrs.filter(wr => (wr.entity || '').toUpperCase() === active);
      disbursements = disbursements.filter(d => (d.entity || '').toUpperCase() === active);
    }

    const eventsByDate = {};
    const addToEvents = (dateStr, type, item) => {
      if (!dateStr) return;
      const key = dateStr.slice(0, 10);
      if (!eventsByDate[key]) eventsByDate[key] = [];
      if (!eventsByDate[key].some(e => e.type === type && e.data.id === item.id)) {
        eventsByDate[key].push({ type, data: item });
      }
    };

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const getDatesInRange = (startStr, endStr) => {
      const dates = [];
      const start = new Date(startStr + 'T00:00:00');
      const end = new Date(endStr + 'T00:00:00');
      const curr = new Date(start);
      while (curr <= end) {
        dates.push(`${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`);
        curr.setDate(curr.getDate() + 1);
      }
      return dates;
    };

    wrs.forEach(wr => {
      if (wr.dueDate && wr.status !== 'Cancelled') {
        const due = wr.dueDate.slice(0, 10);
        if (due >= todayStr) {
          getDatesInRange(todayStr, due).forEach(date => addToEvents(date, 'wr', wr));
        } else {
          addToEvents(wr.dueDate, 'wr', wr);
        }
      }
    });

    disbursements.forEach(d => {
      if (['Draft', 'Pending', 'Approved', 'Released'].includes(d.status)) {
        let dDate = d.dueDate || d.submittedAt;
        if (d.linkedWorkRequestId) {
          const wr = wrs.find(w => w.id === d.linkedWorkRequestId);
          if (wr && wr.dueDate) dDate = wr.dueDate;
        }
        if (dDate) {
          const due = dDate.slice(0, 10);
          if (due >= todayStr) {
            getDatesInRange(todayStr, due).forEach(date => addToEvents(date, 'db', d));
          } else {
            addToEvents(dDate, 'db', d);
          }
        }
      }
    });

    return eventsByDate;
  },

  getEventSpanClasses(ev, dateStr, events) {
    const d = new Date(dateStr + 'T00:00:00');
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 1);
    const prevStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;

    const isOnPrev = (events[prevStr] || []).some(e => e.type === ev.type && e.data.id === ev.data.id);
    const isOnNext = (events[nextStr] || []).some(e => e.type === ev.type && e.data.id === ev.data.id);

    const classes = [];
    if (isOnPrev) classes.push('span-left');
    if (isOnNext) classes.push('span-right');
    return classes.join(' ');
  },

  createWeekEventOverlay(ev, dayIdx, spanDays, slotIdx, topOffset, dateStr) {
    const isCompleted = ev.type === 'wr' ? ev.data.status === 'Completed' : ev.data.status === 'Released';

    let colorClass = 'bg-cyan-500';
    let avatarName = 'U';

    if (isCompleted) {
      colorClass = 'bg-green-500';
    }

    if (ev.type === 'wr') {
      if (!isCompleted) {
        const wrTasks = this._getTasksForWorkRequest(ev.data.id);
        const total = wrTasks.length;
        if (total === 0) {
          colorClass = 'bg-purple-500';
        } else {
          const comp = wrTasks.filter(t => t.status === 'Completed').length;
          const pct = comp / total;
          if (pct === 1) colorClass = 'bg-green-500';
          else if (pct >= 0.5) colorClass = 'bg-blue-500';
          else if (pct > 0) colorClass = 'bg-yellow-500';
          else colorClass = 'bg-orange-500';
        }
        if (ev.data.status === 'Cancelled') colorClass = 'bg-orange-500';
      }

      if (ev.data.assignedTo) {
        const u = window.apiClient.userCache.getById(ev.data.assignedTo);
        if (u) avatarName = u.name;
      }
    } else {
      if (!isCompleted) {
        const s = ev.data.status;
        if (s === 'Approved') colorClass = 'bg-blue-500';
        else if (s === 'Pending') colorClass = 'bg-yellow-500';
        else if (s === 'Draft') colorClass = 'bg-purple-500';
        else colorClass = 'bg-purple-500';
      }

      if (ev.data.requestedBy) {
        const u = window.apiClient.userCache.getById(ev.data.requestedBy);
        if (u) avatarName = u.name;
      }
    }

    const overlay = el('div', {
      class: `week-event-overlay ${colorClass} ${isCompleted ? 'completed' : ''}`,
      title: ev.type === 'wr' ? `Work Request: ${ev.data.title}` : `Disbursement: ${ev.data.description}`
    });

    const left = `calc(var(--time-width) + ${dayIdx} * var(--day-width) + 4px)`;
    const width = `calc(${spanDays} * var(--day-width) - 8px)`;
    const top = `calc(var(--header-height) + ${slotIdx} * var(--row-height) + ${topOffset}px + 4px)`;

    overlay.style.left = left;
    overlay.style.width = width;
    overlay.style.top = top;

    const avatarWrap = el('div', { class: 'week-event-avatars' });
    const img = el('img', { class: 'week-event-avatar', src: `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=random` });
    avatarWrap.appendChild(img);
    overlay.appendChild(avatarWrap);

    const titleText = ev.type === 'wr' ? ev.data.title : ev.data.description;
    const entityPrefix = ev.data.entity ? `[${ev.data.entity.toUpperCase()}] ` : '';
    overlay.appendChild(el('span', { class: 'week-event-title', text: entityPrefix + titleText }));
    overlay.appendChild(el('span', { class: 'week-event-arrow', text: '›' }));

    overlay.onclick = (e) => {
      e.stopPropagation();
      this.selectedDay = dateStr;
      this.expandedItemId = ev.data.id;
      this.refreshCalendarCard();
    };

    return overlay;
  },

  createMonthEventOverlay(ev, dayIdx, spanDays, rowIdx, offset, dateStr) {
    const isCompleted = ev.type === 'wr' ? ev.data.status === 'Completed' : ev.data.status === 'Released';

    let colorClass = 'bg-cyan-500';

    if (isCompleted) {
      colorClass = 'bg-green-500';
    } else if (ev.type === 'wr') {
      const wrTasks = this._getTasksForWorkRequest(ev.data.id);
      const total = wrTasks.length;
      if (total === 0) {
        colorClass = 'bg-purple-500';
      } else {
        const comp = wrTasks.filter(t => t.status === 'Completed').length;
        const pct = comp / total;
        if (pct === 1) colorClass = 'bg-green-500';
        else if (pct >= 0.5) colorClass = 'bg-blue-500';
        else if (pct > 0) colorClass = 'bg-yellow-500';
        else colorClass = 'bg-orange-500';
      }
      if (ev.data.status === 'Cancelled') colorClass = 'bg-orange-500';
    } else {
      const s = ev.data.status;
      if (s === 'Released') colorClass = 'bg-green-500';
      else if (s === 'Approved') colorClass = 'bg-blue-500';
      else if (s === 'Pending') colorClass = 'bg-yellow-500';
      else colorClass = 'bg-purple-500';
    }

    const overlay = el('div', {
      class: `month-event-overlay ${colorClass} ${isCompleted ? 'completed' : ''}`,
      title: ev.type === 'wr' ? `Work Request: ${ev.data.title}` : `Disbursement: ${ev.data.description}`
    });

    const left = `calc(${dayIdx} * (100% - 24px) / 7 + ${dayIdx} * 4px + 2px)`;
    const width = `calc(${spanDays} * (100% - 24px) / 7 + ${spanDays - 1} * 4px - 4px)`;
    const top = `calc(40px + ${rowIdx} * 4px + ${rowIdx} * (100% - 60px) / 6 + 24px + ${offset * 16}px + 2px)`;

    overlay.style.left = left;
    overlay.style.width = width;
    overlay.style.top = top;

    const titleText = ev.type === 'wr' ? ev.data.title : ev.data.description;
    const entityPrefix = ev.data.entity ? `[${ev.data.entity.toUpperCase()}] ` : '';
    overlay.appendChild(el('span', { class: 'week-event-title', text: entityPrefix + titleText }));

    overlay.onclick = (e) => {
      e.stopPropagation();
      this.selectedDay = dateStr;
      this.expandedItemId = ev.data.id;
      this.refreshCalendarCard();
    };

    return overlay;
  },

  setupAutoScroll(grid) {
    if (!grid) return;
    const cells = grid.querySelectorAll('.calendar-cell');
    cells.forEach(cell => {
      const eventsContainer = cell.querySelector('.calendar-cell-events');
      if (!eventsContainer) return;

      const badges = eventsContainer.querySelectorAll('.calendar-event-badge');
      if (badges.length <= 2) return;

      eventsContainer.classList.add('auto-scroll');

      let scrollPos = 0;
      let direction = 1;
      const speed = 0.5;
      const pauseTicks = 60;
      let pauseCounter = 0;

      const tick = () => {
        if (!eventsContainer.isConnected) return;

        const maxScroll = eventsContainer.scrollHeight - eventsContainer.clientHeight;
        if (maxScroll <= 0) return;

        if (pauseCounter > 0) {
          pauseCounter--;
          requestAnimationFrame(tick);
          return;
        }

        scrollPos += direction * speed;
        if (scrollPos >= maxScroll) {
          scrollPos = maxScroll;
          direction = -1;
          pauseCounter = pauseTicks;
        } else if (scrollPos <= 0) {
          scrollPos = 0;
          direction = 1;
          pauseCounter = pauseTicks;
        }

        eventsContainer.scrollTop = scrollPos;
        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    });
  },

  refreshCalendarCard() {
    if (this.calendarCardRef) {
      this.renderCalendarCard(this.calendarCardRef);
    }
  },

  renderSidebarContent(sidebar, events) {
    sidebar.innerHTML = '';

    if (this.selectedDay) {
      const headerRow = el('div', { class: 'sidebar-header' });
      headerRow.appendChild(el('h3', { class: 'sidebar-title', text: `Schedule: ${formatDate(this.selectedDay)}` }));

      const clearBtn = el('button', { class: 'btn btn-secondary btn-xs', text: 'Clear' });
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        this.selectedDay = null;
        this.expandedItemId = null;
        this.refreshCalendarCard();
      };
      headerRow.appendChild(clearBtn);
      sidebar.appendChild(headerRow);

      const dayEvents = events[this.selectedDay] || [];
      if (dayEvents.length === 0) {
        sidebar.appendChild(renderEmptyState('Nothing scheduled for this day'));
      } else {
        const wrs = dayEvents.filter(e => e.type === 'wr');
        const dbs = dayEvents.filter(e => e.type === 'db');

        if (wrs.length > 0) {
          const sec = el('div', { class: 'sidebar-section' });
          sec.appendChild(el('h4', { text: 'Work Requests' }));
          wrs.forEach(ev => sec.appendChild(this.renderSidebarItemCard('wr', ev.data)));
          sidebar.appendChild(sec);
        }
        if (dbs.length > 0) {
          const sec = el('div', { class: 'sidebar-section' });
          sec.appendChild(el('h4', { text: 'Disbursements' }));
          dbs.forEach(ev => sec.appendChild(this.renderSidebarItemCard('db', ev.data)));
          sidebar.appendChild(sec);
        }
      }
    } else {
      sidebar.appendChild(el('h3', { class: 'sidebar-title', text: 'Upcoming This Week' }));

      const now = new Date();
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const weekEndMidnight = todayMidnight + 7 * 86400000;

      const upcomingEvents = [];
      Object.keys(events).forEach(dateKey => {
        const d = new Date(dateKey).getTime();
        if (d >= todayMidnight && d <= weekEndMidnight) {
          events[dateKey].forEach(ev => upcomingEvents.push(ev));
        }
      });

      if (upcomingEvents.length === 0) {
        sidebar.appendChild(renderEmptyState('No items due this week'));
      } else {
        upcomingEvents.sort((a, b) => {
          const dateA = new Date(a.type === 'wr' ? a.data.dueDate : (a.data.dueDate || a.data.submittedAt));
          const dateB = new Date(b.type === 'wr' ? b.data.dueDate : (b.data.dueDate || b.data.submittedAt));
          return dateA - dateB;
        });

        const wrs = upcomingEvents.filter(e => e.type === 'wr');
        const dbs = upcomingEvents.filter(e => e.type === 'db');

        if (wrs.length > 0) {
          const sec = el('div', { class: 'sidebar-section' });
          sec.appendChild(el('h4', { text: 'Work Requests Due This Week' }));
          wrs.forEach(ev => sec.appendChild(this.renderSidebarItemCard('wr', ev.data)));
          sidebar.appendChild(sec);
        }
        if (dbs.length > 0) {
          const sec = el('div', { class: 'sidebar-section' });
          sec.appendChild(el('h4', { text: 'Upcoming Disbursements' }));
          dbs.forEach(ev => sec.appendChild(this.renderSidebarItemCard('db', ev.data)));
          sidebar.appendChild(sec);
        }
      }
    }
  },

  renderSidebarItemCard(type, item) {
    const isExpanded = this.expandedItemId === item.id;
    const card = el('div', { class: `sidebar-item ${type}-item ${isExpanded ? 'expanded' : ''}` });

    const header = el('div', { class: 'sidebar-item-header' });
    const titleText = type === 'wr' ? item.title : item.description;
    const dateText = type === 'wr' ? formatDate(item.dueDate) : formatDate(item.dueDate || item.submittedAt);

    const info = el('div', { class: 'item-info' });
    info.appendChild(el('span', { class: 'item-title', text: titleText }));
    info.appendChild(el('span', { class: 'item-date', text: dateText }));
    header.appendChild(info);

    const arrow = el('span', { class: 'item-arrow', text: '›' });
    header.appendChild(arrow);
    card.appendChild(header);

    if (isExpanded) {
      const details = el('div', { class: 'sidebar-item-details' });

      if (type === 'wr') {
        const client = item.clientId ? window.apiClient.clientCache.getById(item.clientId) : null;
        const assigned = item.assignedTo ? window.apiClient.userCache.getById(item.assignedTo) : null;
        details.appendChild(this.renderDetailRow('Entity', item.entity.toUpperCase()));
        details.appendChild(this.renderDetailRow('Client', client ? client.name : '—'));
        details.appendChild(this.renderDetailRow('Status', item.status));
        details.appendChild(this.renderDetailRow('Assigned', assigned ? assigned.name : '—'));

        const myTasks = (this._dataCache?.tasks || []).filter(t => t.workRequestId === item.id && t.assigneeId === Auth.user?.id && t.status !== 'Completed');
        if (myTasks.length > 0) {
          const taskWrap = el('div', { class: 'detail-desc', style: 'border-left-color: var(--color-warning);' });
          taskWrap.appendChild(el('strong', { text: `My Incomplete Tasks (${myTasks.length}):` }));
          const ul = el('ul', { style: 'margin: 4px 0 0 16px; padding: 0;' });
          myTasks.forEach(t => {
            ul.appendChild(el('li', { text: t.title }));
          });
          taskWrap.appendChild(ul);
          details.appendChild(taskWrap);
        } else if (item.description) {
          details.appendChild(el('div', { class: 'detail-desc', text: item.description }));
        }
      } else {
        const emp = item.requestedBy ? window.apiClient.userCache.getById(item.requestedBy || item.employeeId) : null;
        details.appendChild(this.renderDetailRow('Entity', item.entity.toUpperCase()));
        details.appendChild(this.renderDetailRow('Category', item.category));
        details.appendChild(this.renderDetailRow('Amount', formatPHP(item.amount)));
        details.appendChild(this.renderDetailRow('Status', item.status));
        details.appendChild(this.renderDetailRow('Fund Source', item.fundSource));
        details.appendChild(this.renderDetailRow('Requested By', emp ? emp.name : '—'));
      }

      const btnText = type === 'wr' ? 'View Tasks' : 'View Disbursement';
      const viewBtn = el('button', { class: 'btn btn-primary btn-xs btn-block', style: 'margin-top:12px;', text: btnText });
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        if (type === 'wr') {
          location.hash = '#operations/detail/' + item.id;
        } else {
          location.hash = '#disbursement/detail/' + item.id;
        }
      };
      details.appendChild(viewBtn);

      card.appendChild(details);
    }

    card.onclick = (e) => {
      e.stopPropagation();
      this.expandedItemId = isExpanded ? null : item.id;
      this.refreshCalendarCard();
    };

    return card;
  },

  renderDetailRow(label, value) {
    const row = el('div', { class: 'detail-row' });
    row.appendChild(el('span', { class: 'detail-lbl', text: label }));
    row.appendChild(el('span', { class: 'detail-val', text: value }));
    return row;
  },

  // ============================================================
  // API data loading and normalization helpers
  // ============================================================

  async ensureData() {
    if (this._dataPromise) return this._dataPromise;
    this._dataPromise = this._loadData().finally(() => { this._dataPromise = null; });
    return this._dataPromise;
  },

  async _loadData() {
    const active = (Auth.activeEntity || '').toUpperCase();
    const userEntities = (Auth.user?.entities || []).map(e => e.toUpperCase());
    const entitiesToLoad = active === 'ALL'
      ? userEntities.filter(e => ['ATA', 'LTA'].includes(e))
      : [active];

    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
    ]);

    const results = await Promise.all(entitiesToLoad.map(code => this._loadEntityData(code)));

    const workRequests = [];
    const disbursements = [];
    const analyticsByEntity = {};

    results.forEach((res, idx) => {
      const code = entitiesToLoad[idx];
      analyticsByEntity[code] = res.analytics;
      workRequests.push(...res.workRequests);
      disbursements.push(...res.disbursements);
    });

    const tasksByWr = await this._loadTasksForWorkRequests(workRequests);
    const tasks = [];
    tasksByWr.forEach(list => tasks.push(...list));

    this._dataCache = {
      analyticsByEntity,
      workRequests,
      disbursements,
      tasksByWr,
      tasks,
      loadedAt: Date.now(),
    };
  },

  async _loadEntityData(entityCode) {
    const prevEntity = Auth.activeEntity;
    Auth.activeEntity = entityCode;
    try {
      const [analyticsRes, wrRes, dbRes] = await Promise.all([
        window.apiClient.reports.analytics().catch(err => {
          console.warn(`Analytics fetch failed for ${entityCode}:`, err);
          return { data: null };
        }),
        window.apiClient.workRequests.list({ limit: 1000 }).catch(err => {
          console.warn(`Work requests fetch failed for ${entityCode}:`, err);
          return { data: [] };
        }),
        window.apiClient.disbursements.list({ limit: 1000 }).catch(err => {
          console.warn(`Disbursements fetch failed for ${entityCode}:`, err);
          return { data: [] };
        }),
      ]);

      return {
        analytics: analyticsRes.data,
        workRequests: (wrRes.data || []).map(wr => ({ ...wr, entity: wr.entity || entityCode })),
        disbursements: (dbRes.data || []).map(d => this._normalizeDisbursement(d, entityCode)),
      };
    } finally {
      Auth.activeEntity = prevEntity;
    }
  },

  async _loadTasksForWorkRequests(workRequests) {
    const tasksByWr = new Map();
    if (!workRequests || workRequests.length === 0) return tasksByWr;

    // Limit concurrency to avoid hammering the backend with one request per WR.
    const CONCURRENCY = 5;
    for (let i = 0; i < workRequests.length; i += CONCURRENCY) {
      const batch = workRequests.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (wr) => {
        try {
          const res = await window.apiClient.workRequests.listTasks(wr.id);
          tasksByWr.set(wr.id, res.data || []);
        } catch (e) {
          console.warn('Failed to load tasks for work request', wr.id, e);
          tasksByWr.set(wr.id, []);
        }
      }));
    }
    return tasksByWr;
  },

  _normalizeDisbursement(d, entityCode) {
    if (!d) return d;
    return {
      ...d,
      entity: entityCode,
      description: d.description,
      category: d.category,
      amount: Number(d.amount) || 0,
      status: d.status,
      fundSource: d.fund_source || d.fundSource,
      dueDate: d.due_date || d.dueDate,
      submittedAt: d.submitted_at || d.submittedAt,
      requestedBy: d.requested_by || d.requestedBy,
      employeeId: d.employee_id || d.employeeId,
      linkedWorkRequestId: d.linked_work_request_id || d.linkedWorkRequestId,
      linkedInvoiceId: d.linked_invoice_id || d.linkedInvoiceId,
    };
  },

  _getTasksForWorkRequest(wrId) {
    return this._dataCache?.tasksByWr?.get(wrId) || [];
  },

};
