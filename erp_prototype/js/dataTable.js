/**
 * DataTable – reusable table view with checkbox selection and floating bulk actions.
 *
 * Render a consistent list/table experience across Operations, Billing,
 * Disbursement, and Transmittal. It reuses the existing jira-backlog-bulk-bar
 * styling already defined in the ERP stylesheet.
 */
(function () {
  function isNode(v) {
    return v && typeof v.nodeType === 'number';
  }

  const DataTable = {
    /**
     * Render a data table.
     *
     * @param {Object} options
     * @param {Array} options.items – rows to render
     * @param {Array} options.columns – column definitions:
     *   { key, label, render(item), align, width, minWidth, class, headerClass }
     * @param {boolean} [options.selectable=true] – show row checkboxes
     * @param {Array|Function} [options.bulkActions] – actions for selected rows:
     *   function(ids) => [{ text, className, onClick(ids) }]
     * @param {Function} [options.rowId=(item)=>item.id] – unique id per row
     * @param {Function} [options.onRowClick] – (item, event) fired when a row is clicked
     * @param {HTMLElement|string} [options.emptyState] – shown when items is empty
     * @param {string} [options.tableClass='data-table']
     * @param {string|Function} [options.rowClass]
     * @returns {HTMLElement}
     */
    render(options = {}) {
      const {
        items = [],
        columns = [],
        selectable = true,
        bulkActions,
        rowId = (item) => item.id,
        onRowClick,
        emptyState,
        tableClass = 'data-table',
        rowClass
      } = options;

      const wrapper = el('div', { class: 'jira-backlog-container jira-backlog-container--columns data-table-view' });

      if (items.length === 0) {
        if (emptyState) {
          if (isNode(emptyState)) wrapper.appendChild(emptyState);
          else wrapper.textContent = String(emptyState);
        } else {
          wrapper.appendChild(renderEmptyState('No items found', null, { variant: 'zero-state' }));
        }
        return wrapper;
      }

      const table = el('table', { class: tableClass + (selectable ? ' data-table--selectable' : '') });
      const thead = el('thead');
      const headerRow = el('tr');

      let selectAllCheckbox = null;
      if (selectable) {
        const thChk = el('th', { class: 'dt-checkbox-col' });
        selectAllCheckbox = el('input', {
          type: 'checkbox',
          class: 'dt-select-all',
          title: 'Select all'
        });
        thChk.appendChild(selectAllCheckbox);
        headerRow.appendChild(thChk);
      }

      // Icon column header
      const thIcon = el('th', { class: 'dt-icon-col', style: 'width: 24px; min-width: 24px; padding: 0;' });
      headerRow.appendChild(thIcon);

      columns.forEach((col, colIdx) => {
        const alignClass = col.align ? ' dt-cell--' + col.align : '';
        const roleClass = colIdx === 0 ? ' dt-key-col' : (colIdx === 1 ? ' dt-title-col' : '');
        const th = el('th', { class: (col.headerClass || '') + alignClass + roleClass });
        th.textContent = col.label || '';
        if (col.align) th.style.textAlign = col.align;
        if (col.width) th.style.width = col.width;
        if (col.minWidth) th.style.minWidth = col.minWidth;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = el('tbody');
      const rowRefs = [];
      const selectedIds = new Set();

      const makeUpdateBulkBar = () => () => {
        if (!bulkBar) return;
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          bulkBar.classList.add('hidden');
          if (selectAllCheckbox) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
          }
          return;
        }

        const actionsList = typeof bulkActions === 'function' ? bulkActions(ids) : bulkActions;
        const finalActions = actionsList || [];

        if (finalActions.length === 0) {
          bulkBar.classList.add('hidden');
        } else {
          bulkCount.textContent = `${ids.length} selected`;
          bulkActionsContainer.innerHTML = '';
          finalActions.forEach(act => {
            const btn = el('button', {
              class: act.className || 'btn btn-secondary btn-sm',
              text: act.text
            });
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              act.onClick(ids);
            });
            bulkActionsContainer.appendChild(btn);
          });
          bulkBar.classList.remove('hidden');
        }

        if (selectAllCheckbox) {
          const allChecked = rowRefs.length > 0 && rowRefs.every(r => r.chk.checked);
          const someChecked = rowRefs.some(r => r.chk.checked);
          selectAllCheckbox.checked = allChecked;
          selectAllCheckbox.indeterminate = someChecked && !allChecked;
        }
      };

      let bulkBar = null;
      let bulkCount = null;
      let bulkActionsContainer = null;
      let bulkClose = null;
      let updateBulkBar = () => {};

      if (selectable && bulkActions) {
        bulkBar = el('div', { class: 'jira-backlog-bulk-bar data-table-bulk-bar hidden' });
        bulkCount = el('span', { class: 'jira-backlog-bulk-count', text: '0 selected' });
        bulkBar.appendChild(bulkCount);
        bulkBar.appendChild(el('span', { class: 'jira-backlog-bulk-divider', text: '|' }));
        bulkActionsContainer = el('div', { class: 'jira-backlog-bulk-actions' });
        bulkBar.appendChild(bulkActionsContainer);
        bulkBar.appendChild(el('span', { class: 'jira-backlog-bulk-divider', text: '|' }));
        bulkClose = el('button', { class: 'jira-backlog-bulk-close', html: '&times;', title: 'Clear selection' });
        bulkBar.appendChild(bulkClose);

        updateBulkBar = makeUpdateBulkBar();

        bulkClose.addEventListener('click', () => {
          selectedIds.clear();
          rowRefs.forEach(r => { r.chk.checked = false; r.tr.classList.remove('selected'); });
          updateBulkBar();
        });
      }

      items.forEach(item => {
        const id = rowId(item);
        const trClasses = rowClass
          ? (typeof rowClass === 'function' ? rowClass(item) : rowClass)
          : '';
        const tr = el('tr', { class: trClasses });

        if (selectable) {
          const tdChk = el('td', { class: 'dt-checkbox-col' });
          const chk = el('input', { type: 'checkbox', class: 'dt-row-checkbox' });
          chk.dataset.id = id;
          tdChk.appendChild(chk);
          tr.appendChild(tdChk);
          rowRefs.push({ chk, id, tr });

          chk.addEventListener('change', () => {
            if (chk.checked) {
              selectedIds.add(id);
              tr.classList.add('selected');
            } else {
              selectedIds.delete(id);
              tr.classList.remove('selected');
            }
            updateBulkBar();
          });
        }

        // Icon column cell
        const strId = String(id);
        let iconHtml = '';
        if (strId.startsWith('WR')) {
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';
        } else if (strId.startsWith('INV')) {
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
        } else if (strId.startsWith('DV') || strId.startsWith('DISB')) {
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';
        } else if (strId.startsWith('TR')) {
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
        } else {
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        }
        const tdIcon = el('td', { class: 'dt-icon-cell', html: iconHtml });
        tr.appendChild(tdIcon);

        columns.forEach((col, colIdx) => {
          const alignClass = col.align ? ' dt-cell--' + col.align : '';
          const roleClass = colIdx === 0 ? ' dt-key-col' : (colIdx === 1 ? ' dt-title-col' : '');
          const td = el('td', { class: (col.class || '') + alignClass + roleClass });
          if (col.align) td.style.textAlign = col.align;
          const rendered = col.render ? col.render(item) : (item[col.key] ?? '');
          if (isNode(rendered)) {
            td.appendChild(rendered);
          } else {
            td.textContent = rendered == null || rendered === '' ? '—' : String(rendered);
          }
          tr.appendChild(td);
        });

        if (onRowClick) {
          tr.style.cursor = 'pointer';
          tr.dataset.clickable = 'true';
          tr.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select, .no-row-click, label, .dt-actions-col')) return;
            onRowClick(item, e);
          });
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrapper.appendChild(table);

      if (bulkBar) wrapper.appendChild(bulkBar);

      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
          rowRefs.forEach(r => {
            r.chk.checked = selectAllCheckbox.checked;
            if (r.chk.checked) {
              selectedIds.add(r.id);
              r.tr.classList.add('selected');
            } else {
              selectedIds.delete(r.id);
              r.tr.classList.remove('selected');
            }
          });
          updateBulkBar();
        });
      }

      return wrapper;
    },

    /**
     * Render a priority pill with a colored dot.
     * Urgent = red, Priority / Low Priority = theme warning, Low / Normal = muted.
     */
    priorityCell(priority) {
      const value = (priority || '').trim();
      if (!value || value === 'Normal') return el('span', { class: 'dt-priority-muted', text: '—' });

      const map = {
        'Urgent': { cls: 'dt-priority-urgent', dot: '#ef4444' },
        'Priority': { cls: 'dt-priority-medium', dot: '#f59e0b' },
        'Low Priority': { cls: 'dt-priority-low', dot: '#22c55e' },
        'Low': { cls: 'dt-priority-low', dot: '#94a3b8' }
      };
      const config = map[value] || { cls: 'dt-priority-muted', dot: '#94a3b8' };

      const wrap = el('span', { class: 'dt-priority-pill ' + config.cls });
      const dot = el('span', { class: 'dt-priority-dot' });
      dot.style.backgroundColor = config.dot;
      wrap.appendChild(dot);
      wrap.appendChild(document.createTextNode(value === 'Low Priority' ? 'Low' : value));
      return wrap;
    }
  };

  window.DataTable = DataTable;
})();
