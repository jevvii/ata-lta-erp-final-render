/**
 * Document Management System (DMS)
 * Upload, version tracking, handover log, comments, lifecycle, filters, view modes.
 */

const DMS = {
  view: 'list',
  detailId: null,
  listViewMode: 'table',

  render() {
    this.listViewMode = App.getPreferredViewMode('documents');

    const container = el('div', { class: 'page documents-tab-page' });
    const title = el('h1', { text: 'Documents', class: 'page-title-bar-v2' });
    container.appendChild(title);

    if (this.view === 'list') container.appendChild(this.renderList());
    else if (this.view === 'form') container.appendChild(this.renderForm());
    else if (this.view === 'detail') container.appendChild(this.renderDetail());

    return container;
  },

  init() {},

  // ============================================================
  // Helpers
  // ============================================================
  docTypeBadge(type) {
    const map = {
      'original_scan': { cls: 'badge doc-type-badge-original', text: 'Original Scan' },
      'generated_copy': { cls: 'badge doc-type-badge-generated', text: 'Generated Copy' }
    };
    const cfg = map[type] || { cls: 'badge', text: type };
    return el('span', { class: cfg.cls, text: cfg.text });
  },

  lifecycleBadge(state) {
    const cfg = { cls: 'lifecycle-badge lifecycle-' + state, text: (state || 'collected').replace(/_/g, ' ') };
    return el('span', { class: cfg.cls, text: cfg.text });
  },

  lifecycleNext(state) {
    const map = {
      'collected': 'with_documentations',
      'with_documentations': 'scanned',
      'scanned': 'in_envelope',
      'in_envelope': 'stored'
    };
    return map[state] || null;
  },

  lifecycleLabel(state) {
    const map = {
      'collected': 'Collected',
      'with_documentations': 'With Documentations',
      'scanned': 'Scanned',
      'in_envelope': 'In Envelope',
      'stored': 'Stored'
    };
    return map[state] || state;
  },

  // ============================================================
  // List View
  // ============================================================
  renderList() {
    const entity = Auth.activeEntity;

    // Restrict Documents module to roles with dms:edit or dms:handover
    if (!Auth.can('dms:edit') && !Auth.can('dms:handover')) {
      const wrapper = el('div');
      wrapper.appendChild(renderEmptyState('Permission denied', 'Documents are restricted to Admin, Manager, and Documentation users.', { variant: 'zero-state' }));
      return wrapper;
    }

    const actions = el('div', { class: 'actions-bar' });
    const addBtn = el('button', { class: 'btn btn-primary', text: 'Upload Document' });
    addBtn.addEventListener('click', () => { this.view = 'form'; this.detailId = null; App.handleRoute(); });
    actions.appendChild(addBtn);

    // View mode toggle (saveCurrentFilters assigned after filter elements are created)
    let saveCurrentFilters;
    const viewToggle = el('div', { class: 'view-mode-toggle' });
    const viewIcons = { 'Table': ViewIcons.table, 'Board': ViewIcons.board, 'List': ViewIcons.list };
    [['Table', 'table'], ['Board', 'board'], ['List', 'list']].forEach(([label, mode]) => {
      const btn = el('button', { html: (viewIcons[label] || '') + ' ' + label });
      if (this.listViewMode === mode) btn.classList.add('active');
      btn.addEventListener('click', () => {
        saveCurrentFilters();
        App.setPreferredViewMode('documents', mode);
        this.listViewMode = mode;
        this.refreshList(listContainer, activeFilters, groupBy);
      });
      viewToggle.appendChild(btn);
    });
    actions.appendChild(viewToggle);

    // Entity-scope filter — intentional direct check (entity-scope, not permission)
    const canCrossEntity = Auth.isManagerial() && Auth.user.entities.length > 1;

    let entityFilter = null;
    if (canCrossEntity) {
      entityFilter = el('select', { class: 'form-select', style: 'max-width:180px' });
      entityFilter.appendChild(el('option', { value: '', text: 'All Entities' }));
      Auth.user.entities.forEach(e => entityFilter.appendChild(el('option', { value: e, text: e })));
      entityFilter.value = entity;
      actions.appendChild(entityFilter);
    }

    const wrapper = el('div');
    const toolbarStickyWrap = el('div', { class: 'toolbar-sticky-container' });
    toolbarStickyWrap.appendChild(actions);
    wrapper.appendChild(toolbarStickyWrap);

    // Filters bar
    // Jira Filter Toolbar & Active Filters State
    let groupBy = App.restoreGroupBy('documents') || 'none';
    const activeFilters = {
      workRequest: new Set(),
      client: new Set(),
      employee: new Set(),
      date: new Set()
    };

    const savedFilters = App.restoreFilters('documents');
    if (savedFilters) {
      if (Array.isArray(savedFilters.workRequest)) savedFilters.workRequest.forEach(v => activeFilters.workRequest.add(v));
      else if (savedFilters.workRequest) activeFilters.workRequest.add(savedFilters.workRequest);
      if (Array.isArray(savedFilters.client)) savedFilters.client.forEach(v => activeFilters.client.add(v));
      else if (savedFilters.client) activeFilters.client.add(savedFilters.client);
      if (Array.isArray(savedFilters.employee)) savedFilters.employee.forEach(v => activeFilters.employee.add(v));
      else if (savedFilters.employee) activeFilters.employee.add(savedFilters.employee);
      if (Array.isArray(savedFilters.date)) savedFilters.date.forEach(v => activeFilters.date.add(v));
    }

    saveCurrentFilters = () => {
      App.saveFilters('documents', {
        workRequest: Array.from(activeFilters.workRequest),
        client: Array.from(activeFilters.client),
        employee: Array.from(activeFilters.employee),
        date: Array.from(activeFilters.date)
      });
    };

    const getWorkRequestOptions = () => DB.getWhere('workRequests', wr => {
      const wrEnt = (wr.entity || '').toUpperCase();
      return entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt) : wrEnt === entity.toUpperCase();
    }).map(wr => ({ value: wr.id, label: wr.title }));

    const getClientOptions = () => DB.getWhere('clients', c => {
      const clientEnt = (c.entity || '').toUpperCase();
      return entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(clientEnt) : clientEnt === entity.toUpperCase();
    }).map(c => ({ value: c.id, label: c.name }));

    const getEmployeeOptions = () => {
      const set = new Set();
      DB.getWhere('users', u => Auth.ALL_ROLES.includes(u.role)).forEach(u => set.add(u.name));
      (DB.getAll('tasks') || []).forEach(t => {
        const name = (t.assigneeName || '').trim();
        if (name) set.add(name);
      });
      return Array.from(set).map(n => ({ value: n, label: n }));
    };

    const getDueDateOptions = () => [
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Due Today', label: 'Due Today' },
      { value: 'Due This Week', label: 'Due This Week' },
      { value: 'Due This Month', label: 'Due This Month' },
      { value: 'Due Later', label: 'Due Later' }
    ];

    const categories = {
      workRequest: { label: 'Work Request', getOptions: getWorkRequestOptions },
      client: { label: 'Client', getOptions: getClientOptions },
      employee: { label: 'Uploader', getOptions: getEmployeeOptions },
      date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
    };

    const self = this;
    const groupOptions = [
      { key: 'workRequest', label: 'Work Request', getName: doc => {
        const wr = DB.getById('workRequests', doc.workRequestId);
        return wr ? wr.title : 'No Work Request';
      }},
      { key: 'client', label: 'Client', getName: doc => {
        const wr = DB.getById('workRequests', doc.workRequestId);
        const client = wr && DB.getById('clients', wr.clientId);
        return client ? client.name : 'No Client';
      }},
      { key: 'employee', label: 'Uploader', getName: doc => {
        const u = doc.uploader ? DB.getById('users', doc.uploader) : null;
        return u ? u.name : 'No Uploader';
      }},
      { key: 'status', label: 'Lifecycle', getName: doc => self.lifecycleLabel(doc.documentLifecycle || 'collected') }
    ];

    this.searchQuery = '';
    const toolbarContainer = createJiraFilterToolbar({
      moduleName: 'documents',
      searchConfig: {
        placeholder: 'Search document...',
        onSearch: (q) => { this.searchQuery = q; updateFilters(); }
      },
      categories,
      activeFilters,
      onFilterChange: () => {
        saveCurrentFilters();
        updateFilters();
      },
      groupByOptions: groupOptions,
      currentGroupBy: groupBy,
      onGroupByChange: newGroupBy => {
        groupBy = newGroupBy;
        App.saveGroupBy('documents', groupBy);
        updateFilters();
      }
    });

    toolbarStickyWrap.appendChild(toolbarContainer);

    const listContainer = el('div');
    wrapper.appendChild(listContainer);

    const updateFilters = () => this.refreshList(listContainer, activeFilters, groupBy, toolbarStickyWrap);
    updateFilters();
    return wrapper;
  },

  refreshList(container, activeFilters, groupBy = 'none', toolbarContainer = null) {
    while (container.firstChild) container.removeChild(container.firstChild);
    toolbarContainer?.classList.remove('grouped-board-active');
    const entity = Auth.activeEntity;

    let docs = DB.getWhere('documents', d => {
      if (!d.fileName) return false;
      const matchesEntity = (entity === 'ALL' ? Auth.user.entities.includes(d.entity) : d.entity === entity);
      if (!matchesEntity) return false;
      if (d.status === 'Archived' || d.archived === true) return false;
      return true;
    });
    const hasDocs = docs.length > 0;

    if (activeFilters && activeFilters.workRequest && activeFilters.workRequest.size > 0) {
      docs = docs.filter(d => activeFilters.workRequest.has(d.workRequestId));
    }
    if (activeFilters && activeFilters.client && activeFilters.client.size > 0) {
      docs = docs.filter(d => {
        const wr = DB.getById('workRequests', d.workRequestId);
        return wr && activeFilters.client.has(wr.clientId);
      });
    }
    if (activeFilters && activeFilters.employee && activeFilters.employee.size > 0) {
      docs = docs.filter(d => {
        const u = d.uploader ? DB.getById('users', d.uploader) : null;
        return u && activeFilters.employee.has(u.name);
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

      docs = docs.filter(d => {
        const dStr = (d.uploadDate || d.createdAt || '').slice(0, 10);
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
    if (this.searchQuery) {
      docs = docs.filter(d => {
        const wr = d.workRequestId ? DB.getById('workRequests', d.workRequestId) : null;
        const client = wr ? DB.getById('clients', wr.clientId) : null;
        const hay = [
          d.fileName || '',
          d.documentType || '',
          client?.name || '',
          wr?.title || '',
        ].join(' ').toLowerCase();
        return hay.includes(this.searchQuery);
      });
    }

    docs.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    const hasActiveFilters = activeFilters && Object.values(activeFilters).some(s => s && s.size > 0);

    if (docs.length === 0) {
      if (hasActiveFilters && hasDocs) {
        container.appendChild(renderFilterEmptyState(
          'No documents match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('documents'); App.handleRoute(); } }]
        ));
      } else {
        container.appendChild(renderEmptyState('No documents found', null, { variant: 'zero-state' }));
      }
      return;
    }

    if (this.listViewMode === 'table') {
      this.renderTableView(container, docs);
    } else if (this.listViewMode === 'board') {
      this.renderBoardView(container, docs, groupBy, toolbarContainer);
    } else {
      this.renderCompactListView(container, docs);
    }
  },

  renderTableView(container, docs) {
    const table = el('table', { class: 'data-table' });
    const thead = el('thead');
    const thr = el('tr');
    ['Filename', 'Work Request', 'Type', 'Uploader', 'Upload Date', 'Lifecycle', 'Actions'].forEach(h => {
      thr.appendChild(el('th', { text: h }));
    });
    thead.appendChild(thr);
    table.appendChild(thead);

    const tbody = el('tbody');
    docs.forEach(doc => {
      const tr = el('tr');
      tr.appendChild(el('td', { text: doc.fileName }));

      const wr = DB.getById('workRequests', doc.workRequestId);
      const tdWr = el('td');
      if (wr) {
        const wrLink = el('a', { href: '#operations/detail/' + wr.id, text: wr.title });
        wrLink.addEventListener('click', (e) => {
          e.preventDefault();
          location.hash = '#operations/detail/' + wr.id;
        });
        tdWr.appendChild(wrLink);
      } else {
        tdWr.textContent = '—';
      }
      tr.appendChild(tdWr);

      const tdType = el('td');
      tdType.appendChild(this.docTypeBadge(doc.document_type));
      tr.appendChild(tdType);

      const uploader = DB.getById('users', doc.uploader);
      tr.appendChild(el('td', { text: uploader?.name || '—' }));

      tr.appendChild(el('td', { text: formatDate(doc.uploadDate) }));

      const tdLife = el('td');
      tdLife.appendChild(this.lifecycleBadge(doc.documentLifecycle || 'collected'));
      tr.appendChild(tdLife);

      const tdAct = el('td');
      const viewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'View' });
      viewBtn.addEventListener('click', () => { this.view = 'detail'; this.detailId = doc.id; App.handleRoute(); });
      tdAct.appendChild(viewBtn);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  },

  renderBoardView(container, docs, groupBy = 'none', toolbarContainer = null) {
    const states = ['collected', 'with_documentations', 'scanned', 'in_envelope', 'stored'];
    const stateColors = {
      'collected': '#94a3b8',
      'with_documentations': '#3b82f6',
      'scanned': '#f59e0b',
      'in_envelope': '#a855f7',
      'stored': '#10b981'
    };
    const canEdit = Auth.can('dms:edit');
    const self = this;

    const columns = states.map(state => ({
      key: state,
      label: self.lifecycleLabel(state),
      targetStatus: state,
      color: stateColors[state] || '#cbd5e1',
      emptyState: { variant: 'compact', title: `No ${self.lifecycleLabel(state).toLowerCase()}`, body: '' }
    }));

    const groupOptions = [
      { key: 'workRequest', label: 'Work Request', getName: doc => {
        const wr = DB.getById('workRequests', doc.workRequestId);
        return wr ? wr.title : 'No Work Request';
      }},
      { key: 'client', label: 'Client', getName: doc => {
        const wr = DB.getById('workRequests', doc.workRequestId);
        const client = wr && DB.getById('clients', wr.clientId);
        return client ? client.name : 'No Client';
      }},
      { key: 'employee', label: 'Uploader', getName: doc => {
        const u = doc.uploader ? DB.getById('users', doc.uploader) : null;
        return u ? u.name : 'No Uploader';
      }},
      { key: 'status', label: 'Lifecycle', getName: doc => self.lifecycleLabel(doc.documentLifecycle || 'collected') }
    ];

    const renderCard = (doc) => {
      const uploader = DB.getById('users', doc.uploader);
      const badge = self.docTypeBadge(doc.document_type);
      return buildCompactBoardCard({
        key: 'DOC-' + (doc.id || ''),
        title: doc.fileName,
        description: uploader?.name || '—',
        date: doc.uploadDate ? formatDate(doc.uploadDate) : '',
        statusColor: stateColors[doc.documentLifecycle || 'collected'] || '#cbd5e1',
        badges: [badge],
        onClick: () => { self.view = 'detail'; self.detailId = doc.id; App.handleRoute(); }
      });
    };

    const cardMenuItems = (doc) => {
      const menu = [{
        label: 'View Details',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        onClick: () => { self.view = 'detail'; self.detailId = doc.id; App.handleRoute(); }
      }];
      const nextState = self.lifecycleNext(doc.documentLifecycle || 'collected');
      if (canEdit && nextState) {
        menu.push({
          label: `Move to ${self.lifecycleLabel(nextState)}`,
          className: 'primary',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M19 12l-4-4m4 4l-4 4"/></svg>',
          onClick: () => {
            const updates = { documentLifecycle: nextState };
            if (nextState === 'with_documentations') updates.receivedByDocumentationAt = new Date().toISOString();
            if (nextState === 'scanned') updates.scannedAt = new Date().toISOString();
            if (nextState === 'in_envelope') updates.storedInEnvelopeAt = new Date().toISOString();
            if (nextState === 'stored') updates.storedAt = new Date().toISOString();
            DB.update('documents', doc.id, updates);
            App.handleRoute();
          }
        });
      }
      return menu;
    };

    if (groupBy !== 'none') {
      toolbarContainer?.classList.add('grouped-board-active');
      renderGroupedKanbanBoard({
        container,
        items: docs,
        columns,
        getColumnKey: doc => doc.documentLifecycle || 'collected',
        renderCard,
        cardMenuItems,
        toolbarContainer,
        groupBy,
        groupOptions,
        storageKey: 'erp_documents_grouped_collapsed'
      });
      return;
    }

    // Normalize boardOrder within each lifecycle column.
    states.forEach(state => {
      const stateDocs = docs.filter(d => (d.documentLifecycle || 'collected') === state);
      stateDocs.sort((a, b) => {
        const oa = typeof a.boardOrder === 'number' ? a.boardOrder : null;
        const ob = typeof b.boardOrder === 'number' ? b.boardOrder : null;
        if (oa !== null && ob !== null) return oa - ob;
        if (oa !== null) return -1;
        if (ob !== null) return 1;
        return new Date(a.uploadDate || 0) - new Date(b.uploadDate || 0);
      });
      stateDocs.forEach((doc, idx) => {
        const newOrder = (idx + 1) * 1000;
        if (doc.boardOrder !== newOrder) {
          doc.boardOrder = newOrder;
          DB.update('documents', doc.id, { boardOrder: newOrder });
        }
      });
    });

    KanbanBoard.render({
      container,
      items: docs,
      getColumnKey: doc => doc.documentLifecycle || 'collected',
      columns,
      renderCard,
      cardMenuItems,
      drag: {
        enabled: true,
        canDrag: () => canEdit,
        canDrop: ({ item, targetStatus }) => {
          const currentState = item.documentLifecycle || 'collected';
          if (currentState === targetStatus) return true;
          const flow = ['collected', 'with_documentations', 'scanned', 'in_envelope', 'stored'];
          const currentIdx = flow.indexOf(currentState);
          const targetIdx = flow.indexOf(targetStatus);
          if (currentIdx === -1 || targetIdx === -1) return false;
          return targetIdx > currentIdx;
        },
        orderField: 'boardOrder',
        onDrop({ item, targetStatus, newOrder, fromStatus }) {
          const currentState = item.documentLifecycle || 'collected';
          if (currentState === targetStatus) {
            DB.update('documents', item.id, { boardOrder: newOrder });
            App.handleRoute();
            return;
          }

          const stageLabel = self.lifecycleLabel(targetStatus) || targetStatus;
          const applyMove = () => {
            const changes = { boardOrder: newOrder, documentLifecycle: targetStatus };
            if (targetStatus === 'with_documentations') changes.receivedByDocumentationAt = new Date().toISOString();
            if (targetStatus === 'scanned') changes.scannedAt = new Date().toISOString();
            if (targetStatus === 'in_envelope') changes.storedInEnvelopeAt = new Date().toISOString();
            if (targetStatus === 'stored') changes.storedAt = new Date().toISOString();
            DB.update('documents', item.id, changes);
            App.handleRoute();
          };

          Workflow.showConfirm('Confirm Lifecycle Change', `Move "${item.fileName}" to "${stageLabel}"?`, applyMove, 'success');
        }
      }
    });
  },

  renderCompactListView(container, docs) {
    const list = el('div', { class: 'list-view' });
    docs.forEach(doc => {
      const uploader = DB.getById('users', doc.uploader);
      const item = el('div', { class: 'list-item' });
      const left = el('div');
      left.appendChild(el('div', { class: 'list-item-title', text: doc.fileName }));
      left.appendChild(el('div', { class: 'list-item-meta', text: (uploader?.name || '—') + ' • ' + formatDate(doc.uploadDate) }));
      item.appendChild(left);
      const viewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'View' });
      viewBtn.addEventListener('click', () => { this.view = 'detail'; this.detailId = doc.id; App.handleRoute(); });
      item.appendChild(viewBtn);
      list.appendChild(item);
    });
    container.appendChild(list);
  },

  // ============================================================
  // Upload Form
  // ============================================================
  renderForm() {
    const entity = Auth.activeEntity;
    const container = el('div');

    // Form header bar
    const headerBar = el('div', { class: 'form-header-bar' });
    headerBar.appendChild(el('h2', { text: 'Upload Document' }));
    const headerActions = el('div', { class: 'form-actions-top' });
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => { this.view = 'list'; this.detailId = null; App.handleRoute(); });
    headerActions.appendChild(cancelBtn);
    headerBar.appendChild(headerActions);
    container.appendChild(headerBar);

    const form = el('form', { class: 'form-stacked' });

    // File
    const fileGroup = el('div', { class: 'form-group' });
    fileGroup.appendChild(el('label', { text: 'File *' }));
    const fileInput = el('input', { type: 'file', name: 'file', required: true });
    fileGroup.appendChild(fileInput);
    const sizeWarning = el('span', { class: 'field-error hidden', text: '' });
    sizeWarning.id = 'file-size-warning';
    fileGroup.appendChild(sizeWarning);

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file && file.size > 2 * 1024 * 1024) {
        sizeWarning.textContent = 'Warning: File exceeds 2MB. Large files may impact browser performance.';
        sizeWarning.classList.remove('hidden');
      } else {
        sizeWarning.classList.add('hidden');
      }
    });

    form.appendChild(fileGroup);

    // Work Request
    const wrGroup = el('div', { class: 'form-group' });
    wrGroup.appendChild(el('label', { text: 'Work Request *' }));
    const wrSel = el('select', { name: 'workRequestId', required: true });
    wrSel.appendChild(el('option', { value: '', text: '— Select Work Request —' }));
    DB.getWhere('workRequests', wr => wr.entity === entity).forEach(wr => {
      wrSel.appendChild(el('option', { value: wr.id, text: wr.title }));
    });
    wrGroup.appendChild(wrSel);
    form.appendChild(wrGroup);

    // Document Type
    const typeGroup = el('div', { class: 'form-group' });
    typeGroup.appendChild(el('label', { text: 'Document Type *' }));
    const typeWrap = el('div', { class: 'radio-group' });
    [
      { value: 'original_scan', label: 'Original Scan' },
      { value: 'generated_copy', label: 'Generated Copy' }
    ].forEach(opt => {
      const label = el('label', { class: 'radio-label' });
      const radio = el('input', { type: 'radio', name: 'document_type', value: opt.value, required: true });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(' ' + opt.label));
      typeWrap.appendChild(label);
    });
    typeGroup.appendChild(typeWrap);
    form.appendChild(typeGroup);

    // Category
    const catGroup = el('div', { class: 'form-group' });
    catGroup.appendChild(el('label', { text: 'Category *' }));
    const catSel = el('select', { name: 'category', required: true });
    catSel.appendChild(el('option', { value: '', text: '— Select Category —' }));
    ['Requirement Docs', 'Processed Forms', 'Government Receipts', 'Final Deliverables', 'Other'].forEach(c => {
      catSel.appendChild(el('option', { value: c, text: c }));
    });
    catGroup.appendChild(catSel);
    form.appendChild(catGroup);

    // Description
    const descGroup = el('div', { class: 'form-group' });
    descGroup.appendChild(el('label', { text: 'Description' }));
    descGroup.appendChild(el('textarea', { name: 'description', rows: 3 }));
    form.appendChild(descGroup);

    const btnGroup = el('div', { class: 'form-group form-actions' });
    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Upload' });
    btnGroup.appendChild(submitBtn);
    form.appendChild(btnGroup);

    form.addEventListener('submit', (e) => { e.preventDefault(); this.submitUpload(form); });

    container.appendChild(form);
    return container;
  },

  submitUpload(form) {
    if (!validateRequiredFields(form)) return;

    const fileInput = form.querySelector('input[name="file"]');
    const file = fileInput.files[0];
    if (!file) {
      Workflow.showMessage('Selection Error', 'Please select a file.', 'danger');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      this.saveDocument(form, file.name, dataUrl);
    };
    reader.onerror = () => {
      Workflow.showMessage('Read Error', 'Failed to read file.', 'danger');
    };
    reader.readAsDataURL(file);
  },

  saveDocument(form, fileName, dataUrl) {
    const entity = Auth.activeEntity;
    const data = Object.fromEntries(new FormData(form).entries());
    const now = new Date().toISOString();

    const existing = DB.getWhere('documents', d =>
      d.fileName === fileName && d.workRequestId === data.workRequestId
    )[0];

    if (existing) {
      const versionEntry = {
        version: (existing.versions || []).length + 1,
        fileName: existing.fileName,
        uploader: existing.uploader,
        uploadDate: existing.uploadDate,
        dataUrl: existing.dataUrl
      };
      const versions = [...(existing.versions || []), versionEntry];

      DB.update('documents', existing.id, {
        fileName,
        workRequestId: data.workRequestId,
        document_type: data.document_type,
        category: data.category,
        uploader: Auth.user.id,
        uploadDate: now,
        description: data.description || '',
        dataUrl,
        versions,
        handover_log: existing.handover_log || [],
        comments: existing.comments || [],
        documentLifecycle: existing.documentLifecycle || 'collected',
        scannedBy: existing.scannedBy || '',
        envelopeId: existing.envelopeId || '',
        storedLocation: existing.storedLocation || ''
      });
    } else {
      const record = {
        id: generateId('doc'),
        fileName,
        workRequestId: data.workRequestId,
        document_type: data.document_type,
        category: data.category,
        uploader: Auth.user.id,
        uploadDate: now,
        description: data.description || '',
        handover_log: [],
        entity,
        dataUrl,
        versions: [],
        comments: [],
        documentLifecycle: 'collected',
        scannedBy: '',
        envelopeId: '',
        storedLocation: ''
      };
      DB.insert('documents', record);
    }

    this.view = 'list';
    this.detailId = null;
    App.handleRoute();
  },

  // ============================================================
  // Detail View
  // ============================================================
  renderDetail() {
    // Only roles with dms:edit or dms:handover may view document details
    if (!Auth.can('dms:edit') && !Auth.can('dms:handover')) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }

    const doc = DB.getById('documents', this.detailId);
    if (!doc || !doc.fileName) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }

    const container = el('div', { class: 'invoice-detail' });

    // Top actions bar
    const topActions = el('div', { class: 'actions-bar', style: 'margin-bottom: var(--spacing-lg);' });
    const topBackBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '← Back to List' });
    topBackBtn.addEventListener('click', () => { this.view = 'list'; this.detailId = null; App.handleRoute(); });
    topActions.appendChild(topBackBtn);
    container.appendChild(topActions);

    const uploader = DB.getById('users', doc.uploader);

    // Document info
    container.appendChild(el('h2', { text: doc.fileName }));

    const headerRow = el('div', { style: 'display:flex; align-items:center; gap: var(--spacing-md); margin-bottom: var(--spacing-md);' });
    headerRow.appendChild(this.docTypeBadge(doc.document_type));
    headerRow.appendChild(this.lifecycleBadge(doc.documentLifecycle || 'collected'));
    container.appendChild(headerRow);

    const meta = el('div', { class: 'invoice-meta' });
    const wr = DB.getById('workRequests', doc.workRequestId);
    meta.appendChild(el('p', { text: 'Work Request: ' + (wr?.title || '—') }));
    meta.appendChild(el('p', { text: 'Category: ' + (doc.category || '—') }));
    meta.appendChild(el('p', { text: 'Uploader: ' + (uploader?.name || '—') }));
    meta.appendChild(el('p', { text: 'Upload Date: ' + formatDate(doc.uploadDate) }));
    if (doc.description) meta.appendChild(el('p', { text: 'Description: ' + doc.description }));
    if (doc.scannedBy) {
      const scannedBy = DB.getById('users', doc.scannedBy);
      meta.appendChild(el('p', { text: 'Scanned By: ' + (scannedBy?.name || '—') }));
    }
    if (doc.envelopeId) meta.appendChild(el('p', { text: 'Envelope ID: ' + doc.envelopeId }));
    if (doc.storedLocation) meta.appendChild(el('p', { text: 'Stored Location: ' + doc.storedLocation }));
    container.appendChild(meta);

    // Lifecycle transition button
    const nextState = this.lifecycleNext(doc.documentLifecycle || 'collected');
    if (nextState && Auth.can('dms:handover')) {
      const lifecycleActions = el('div', { class: 'form-actions', style: 'margin: var(--spacing-md) 0;' });
      const nextBtn = el('button', { class: 'btn btn-primary', text: 'Move to ' + this.lifecycleLabel(nextState) });
      nextBtn.addEventListener('click', () => this.advanceLifecycle(doc.id, nextState));
      lifecycleActions.appendChild(nextBtn);
      container.appendChild(lifecycleActions);
    }

    // Version History
    const versionSection = el('div', { class: 'dms-detail-section' });
    versionSection.appendChild(el('h3', { text: 'Version History' }));

    const versionCount = (doc.versions || []).length + 1;
    const versionTable = el('table', { class: 'data-table version-table' });
    const vThead = el('thead');
    const vThr = el('tr');
    ['Version', 'Filename', 'Uploader', 'Upload Date'].forEach(h => vThr.appendChild(el('th', { text: h })));
    vThead.appendChild(vThr);
    versionTable.appendChild(vThead);

    const vTbody = el('tbody');
    (doc.versions || []).forEach(v => {
      const vUploader = DB.getById('users', v.uploader);
      const vTr = el('tr');
      vTr.appendChild(el('td', { text: String(v.version) }));
      vTr.appendChild(el('td', { text: v.fileName }));
      vTr.appendChild(el('td', { text: vUploader?.name || '—' }));
      vTr.appendChild(el('td', { text: formatDate(v.uploadDate) }));
      vTbody.appendChild(vTr);
    });
    const curTr = el('tr');
    curTr.appendChild(el('td', { text: String(versionCount) }));
    curTr.appendChild(el('td', { text: doc.fileName }));
    curTr.appendChild(el('td', { text: uploader?.name || '—' }));
    curTr.appendChild(el('td', { text: formatDate(doc.uploadDate) }));
    vTbody.appendChild(curTr);
    versionTable.appendChild(vTbody);
    versionSection.appendChild(versionTable);
    container.appendChild(versionSection);

    // Comments
    const commentsSection = el('div', { class: 'dms-detail-section' });
    commentsSection.appendChild(el('h3', { text: 'Comments' }));

    const comments = doc.comments || [];
    if (comments.length > 0) {
      const thread = el('div', { class: 'comments-thread', style: 'display:flex; flex-direction:column; gap: var(--spacing-md); margin-bottom: var(--spacing-md);' });
      comments.forEach(c => {
        const commentUser = DB.getById('users', c.userId);
        const entry = el('div', { style: 'background: var(--color-bg); padding: var(--spacing-md); border-radius: var(--radius-md);' });
        const header = el('div', { style: 'display:flex; justify-content:space-between; margin-bottom: var(--spacing-xs); font-size:0.8125rem;' });
        header.appendChild(el('span', { style: 'font-weight:600;', text: commentUser?.name || 'Unknown' }));
        header.appendChild(el('span', { style: 'color:var(--color-text-muted);', text: formatDate(c.date) }));
        entry.appendChild(header);
        entry.appendChild(el('p', { style: 'margin:0;', text: c.text }));
        thread.appendChild(entry);
      });
      commentsSection.appendChild(thread);
    } else {
      commentsSection.appendChild(renderEmptyState('No comments yet'));
    }

    if (Auth.can('dms:edit')) {
      const commentForm = el('form', { class: 'form-stacked' });
      const textGroup = el('div', { class: 'form-group' });
      textGroup.appendChild(el('label', { text: 'Add Comment' }));
      const textArea = el('textarea', { name: 'commentText', rows: 2, required: true, placeholder: 'Write a comment…' });
      textGroup.appendChild(textArea);
      commentForm.appendChild(textGroup);

      const postBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Post Comment' });
      commentForm.appendChild(postBtn);

      commentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(commentForm);
        const text = fd.get('commentText').trim();
        if (!text) return;
        this.addComment(doc.id, text);
      });

      commentsSection.appendChild(commentForm);
    }
    container.appendChild(commentsSection);

    // Handover Log (original scans only)
    if (doc.document_type === 'original_scan') {
      const handoverSection = el('div', { class: 'dms-detail-section' });
      handoverSection.appendChild(el('h3', { text: 'Handover Log' }));

      const logTable = el('table', { class: 'data-table handover-table' });
      const hThead = el('thead');
      const hThr = el('tr');
      ['Recipient', 'Date', 'Method'].forEach(h => hThr.appendChild(el('th', { text: h })));
      hThead.appendChild(hThr);
      logTable.appendChild(hThead);

      const hTbody = el('tbody');
      if (doc.handover_log && doc.handover_log.length > 0) {
        doc.handover_log.forEach(entry => {
          const hTr = el('tr');
          hTr.appendChild(el('td', { text: entry.handed_to }));
          hTr.appendChild(el('td', { text: formatDate(entry.handed_date) }));
          hTr.appendChild(el('td', { text: entry.method }));
          hTbody.appendChild(hTr);
        });
      } else {
        const emptyTr = el('tr');
        const emptyTd = el('td', { colspan: '3', text: 'No handover records yet.' });
        emptyTd.style.color = 'var(--color-text-muted)';
        emptyTd.style.fontStyle = 'italic';
        emptyTr.appendChild(emptyTd);
        hTbody.appendChild(emptyTr);
      }
      logTable.appendChild(hTbody);
      handoverSection.appendChild(logTable);

      // Record Handover button and inline form
      if (Auth.can('dms:handover')) {
        const recordBtn = el('button', { class: 'btn btn-primary', text: 'Record Handover' });
        const handoverForm = el('form', { class: 'form-stacked hidden' });

        const recGroup = el('div', { class: 'form-group' });
        recGroup.appendChild(el('label', { text: 'Recipient Name *' }));
        recGroup.appendChild(el('input', { type: 'text', name: 'recipient', required: true }));
        handoverForm.appendChild(recGroup);

        const dateGroup = el('div', { class: 'form-group' });
        dateGroup.appendChild(el('label', { text: 'Handover Date *' }));
        dateGroup.appendChild(el('input', { type: 'date', name: 'handoverDate', value: new Date().toISOString().slice(0, 10), required: true }));
        handoverForm.appendChild(dateGroup);

        const methodGroup = el('div', { class: 'form-group' });
        methodGroup.appendChild(el('label', { text: 'Method *' }));
        const methodSel = el('select', { name: 'method', required: true });
        methodSel.appendChild(el('option', { value: '', text: '— Select Method —' }));
        ['Pickup', 'Courier', 'Email', 'In-Person'].forEach(m => {
          methodSel.appendChild(el('option', { value: m, text: m }));
        });
        methodGroup.appendChild(methodSel);
        handoverForm.appendChild(methodGroup);

        const hfBtnGroup = el('div', { class: 'form-group form-actions' });
        const saveBtn = el('button', { type: 'submit', class: 'btn btn-success', text: 'Save Handover' });
        const cancelHfBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
        cancelHfBtn.addEventListener('click', () => {
          handoverForm.classList.add('hidden');
          recordBtn.classList.remove('hidden');
        });
        hfBtnGroup.appendChild(saveBtn);
        hfBtnGroup.appendChild(cancelHfBtn);
        handoverForm.appendChild(hfBtnGroup);

        handoverForm.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!validateRequiredFields(handoverForm)) return;
          this.recordHandover(this.detailId, new FormData(handoverForm));
        });

        recordBtn.addEventListener('click', () => {
          handoverForm.classList.remove('hidden');
          recordBtn.classList.add('hidden');
        });

        handoverSection.appendChild(recordBtn);
        handoverSection.appendChild(handoverForm);
      } else {
        handoverSection.appendChild(renderEmptyState('Only authorized users can record handovers'));
      }
      container.appendChild(handoverSection);
    }

    return container;
  },

  addComment(docId, text) {
    const doc = DB.getById('documents', docId);
    if (!doc) return;
    const entry = {
      userId: Auth.user.id,
      date: new Date().toISOString(),
      text
    };
    const comments = [...(doc.comments || []), entry];
    DB.update('documents', docId, { comments });
    App.handleRoute();
  },

  advanceLifecycle(docId, nextState) {
    const doc = DB.getById('documents', docId);
    if (!doc) return;

    const updates = { documentLifecycle: nextState };

    if (nextState === 'scanned') {
      updates.scannedBy = Auth.user.id;
    }
    if (nextState === 'in_envelope') {
      const wr = DB.getById('workRequests', doc.workRequestId);
      const clientId = wr?.clientId || 'unknown';
      const existingEnvelopes = DB.getWhere('documents', d => d.envelopeId && d.envelopeId.startsWith('ENVELOPE-' + clientId + '-'));
      const seq = String(existingEnvelopes.length + 1).padStart(3, '0');
      updates.envelopeId = 'ENVELOPE-' + clientId + '-' + seq;
    }
    if (nextState === 'stored') {
      const loc = prompt('Enter storage location:');
      if (!loc) return;
      updates.storedLocation = loc;
    }

    DB.update('documents', docId, updates);
    App.handleRoute();
  },

  recordHandover(docId, formData) {
    const doc = DB.getById('documents', docId);
    if (!doc) return;

    const entry = {
      handed_to: formData.get('recipient'),
      handed_date: formData.get('handoverDate'),
      method: formData.get('method')
    };

    const handover_log = [...(doc.handover_log || []), entry];
    DB.update('documents', docId, { handover_log });
    App.handleRoute();
  }
};
