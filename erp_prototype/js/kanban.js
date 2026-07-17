/**
 * KanbanBoard — reusable, modular board view used across ERP modules.
 *
 * It renders a .board-v2 column layout, supports compact cards built via
 * buildCompactBoardCard(), shared action menus, inline empty states, and an
 * optional drag-and-drop engine with auto-scroll, targeted placeholder
 * insertion, and boardOrder persistence.
 */

/* renderEmptyStateV2 and renderEmptyState are shared helpers defined in utils.js. */

/* ── Shared action menu helpers ── */

function closeAllMenus(except) {
  document.querySelectorAll('.action-menu-list').forEach(m => {
    if (m !== except) {
      m.classList.add('hidden');
      m.classList.remove('open', 'open-up');
    }
  });
  document.querySelectorAll('.menu-open').forEach(el => {
    if (!except || !el.contains(except)) {
      el.classList.remove('menu-open');
    }
  });
}

function positionActionMenu(menu, button) {
  if (!button) return;
  const rect = button.getBoundingClientRect();
  menu.classList.remove('open-up');
  if (rect.bottom > window.innerHeight - 180) {
    menu.classList.add('open-up');
  }
}

function toggleMenu(menu, button) {
  const isCurrentlyHidden = menu.classList.contains('hidden');
  closeAllMenus(menu);
  if (isCurrentlyHidden) {
    positionActionMenu(menu, button);
    menu.classList.remove('hidden');
    requestAnimationFrame(() => menu.classList.add('open'));

    const actionMenuWrap = menu.closest('.card-v2-action-menu');
    const card = menu.closest('.board-card-v2');
    const col = menu.closest('.board-column-v2');
    if (actionMenuWrap) actionMenuWrap.classList.add('menu-open');
    if (card) card.classList.add('menu-open');
    if (col) col.classList.add('menu-open');
  } else {
    menu.classList.remove('open', 'open-up');
    menu.classList.add('hidden');

    const actionMenuWrap = menu.closest('.card-v2-action-menu');
    const card = menu.closest('.board-card-v2');
    const col = menu.closest('.board-column-v2');
    if (actionMenuWrap) actionMenuWrap.classList.remove('menu-open');
    if (card) card.classList.remove('menu-open');
    if (col) col.classList.remove('menu-open');
  }
}

/* ── Column status icons ── */

const KanbanBoardIcons = {
  phase: {
    draft(color) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${escapeHtml(color)}" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;
    },
    'pre-processing'(color) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${escapeHtml(color)}" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="${escapeHtml(color)}"/></svg>`;
    },
    processing(color) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${escapeHtml(color)}" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" fill="${escapeHtml(color)}"/></svg>`;
    },
    completed(color) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="${escapeHtml(color)}"/><polyline points="8 12 11 15 16 9" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  }
};

function buildColumnStatusIcon(column) {
  const color = escapeHtml(column.color || '#94a3b8');
  if (column.icon === 'phase') {
    if (KanbanBoardIcons.phase[column.key]) {
      return KanbanBoardIcons.phase[column.key](color);
    }
    // Phase was requested but no keyed icon exists; fall through to the default dot.
  } else if (typeof column.icon === 'function') {
    return column.icon(color);
  } else if (typeof column.icon === 'string') {
    return column.icon;
  }
  // Default: simple colored dot.
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="${color}"/></svg>`;
}

/* ── KanbanBoard component ── */

const KanbanBoard = {
  render(config = {}) {
    const {
      items = [],
      columns = [],
      getColumnKey,
      renderCard,
      cardMenuItems,
      drag,
      container,
      onEmpty,
      className = 'board-v2'
    } = config;

    const board = el('div', { class: className });
    const itemLookup = new Map();
    items.forEach(item => itemLookup.set(item.id, item));

    const dragConfig = {
      enabled: false,
      canDrag: () => false,
      canDrop: () => false,
      onDrop: () => {},
      onDropDenied: () => {},
      orderField: 'boardOrder',
      getItemId: item => item.id,
      ...drag
    };

    let dragSrcId = null;
    let autoScrollContainer = null;
    let autoScrollDir = 0;
    let autoScrollRaf = null;
    let autoScrollDist = Infinity;
    const SCROLL_MARGIN = 80;
    const SCROLL_SPEED = 20;
    const SCROLL_MAX_SPEED = 55;

    const getTargetContainer = target =>
      target.closest('.board-cards-scroll') || target.closest('.board-column-v2')?.querySelector('.board-cards-scroll');

    function clearDragIndicators() {
      document.querySelectorAll('.board-column-v2.drag-over').forEach(c => c.classList.remove('drag-over'));
      document.querySelectorAll('.board-card-v2.drag-placeholder').forEach(p => p.remove());
    }

    function getDragPlaceholder() {
      let placeholder = document.querySelector('.board-card-v2.drag-placeholder');
      if (!placeholder) {
        placeholder = el('div', { class: 'board-card-v2 compact drag-placeholder' });
      }
      return placeholder;
    }

    function getCardContainerCards(container) {
      return Array.from(container.querySelectorAll('.board-card-v2.compact:not(.dragging):not(.drag-placeholder):not(.add-card)'));
    }

    function updatePlaceholder(cardContainer, y) {
      const draggedId = dragSrcId;
      const cards = getCardContainerCards(cardContainer);
      const placeholder = getDragPlaceholder();

      if (cards.length === 0) {
        const addCard = cardContainer.querySelector('.board-card-v2.add-card');
        if (addCard) cardContainer.insertBefore(placeholder, addCard);
        else cardContainer.appendChild(placeholder);
        return;
      }

      let targetCard = null;
      for (const card of cards) {
        if (card.dataset.itemId === draggedId) continue;
        const rect = card.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (y < mid) {
          targetCard = card;
          break;
        }
      }

      if (targetCard) {
        cardContainer.insertBefore(placeholder, targetCard);
      } else {
        const addCard = cardContainer.querySelector('.board-card-v2.add-card');
        if (addCard) cardContainer.insertBefore(placeholder, addCard);
        else cardContainer.appendChild(placeholder);
      }
    }

    function beginDragAutoScroll() {
      if (autoScrollRaf) return;
      const step = () => {
        if (!autoScrollDir) { autoScrollRaf = null; return; }
        const intensity = Math.min(1, Math.max(0, (SCROLL_MARGIN - autoScrollDist) / SCROLL_MARGIN));
        const speed = Math.max(SCROLL_SPEED, Math.round(SCROLL_SPEED + (SCROLL_MAX_SPEED - SCROLL_SPEED) * intensity));
        let scrolled = false;
        const el = autoScrollContainer;
        if (el) {
          const style = getComputedStyle(el);
          const overflowY = style.overflowY;
          const scrollable = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
          if (scrollable) {
            const prevScrollTop = el.scrollTop;
            el.scrollTop += autoScrollDir * speed;
            if (el.scrollTop !== prevScrollTop) scrolled = true;
          }
        }
        if (!scrolled) {
          window.scrollBy(0, autoScrollDir * speed);
        }
        autoScrollRaf = requestAnimationFrame(step);
      };
      autoScrollRaf = requestAnimationFrame(step);
    }

    function updateDragAutoScroll(clientY, container) {
      autoScrollContainer = container || null;
      let dir = 0;
      let dist = Infinity;

      if (clientY < SCROLL_MARGIN) {
        dir = -1;
        dist = clientY;
      } else if (clientY > window.innerHeight - SCROLL_MARGIN) {
        dir = 1;
        dist = window.innerHeight - clientY;
      } else if (container) {
        const rect = container.getBoundingClientRect();
        const topDist = clientY - rect.top;
        const bottomDist = rect.bottom - clientY;
        if (topDist < SCROLL_MARGIN && topDist >= 0) {
          dir = -1;
          dist = topDist;
        } else if (bottomDist < SCROLL_MARGIN && bottomDist >= 0) {
          dir = 1;
          dist = bottomDist;
        }
      }

      autoScrollDir = dir;
      autoScrollDist = dist;
      if (dir && !autoScrollRaf) beginDragAutoScroll();
    }

    function endDragAutoScroll() {
      autoScrollDir = 0;
      autoScrollDist = Infinity;
      autoScrollContainer = null;
      if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
    }

    function computeDropOrder(cardContainer) {
      const orderField = dragConfig.orderField;
      const cards = getCardContainerCards(cardContainer);
      if (cards.length === 0) return 1000;

      const placeholder = cardContainer.querySelector('.board-card-v2.drag-placeholder');
      let targetIndex = cards.length;
      if (placeholder) {
        let index = 0;
        for (const card of cards) {
          if (placeholder.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) {
            targetIndex = index;
            break;
          }
          index++;
        }
      }

      const getOrder = id => {
        const item = itemLookup.get(id);
        return typeof item?.[orderField] === 'number' ? item[orderField] : null;
      };

      if (targetIndex === 0) {
        const firstOrder = getOrder(cards[0].dataset.itemId);
        return (firstOrder ?? 1000) / 2;
      }
      if (targetIndex >= cards.length) {
        const lastOrder = getOrder(cards[cards.length - 1].dataset.itemId);
        return (lastOrder ?? cards.length * 1000) + 1000;
      }
      const beforeOrder = getOrder(cards[targetIndex - 1].dataset.itemId) ?? targetIndex * 1000;
      const afterOrder = getOrder(cards[targetIndex].dataset.itemId) ?? (targetIndex + 1) * 1000;
      return (beforeOrder + afterOrder) / 2;
    }

    function resolveCardItems(cardContainer) {
      const cards = getCardContainerCards(cardContainer);
      const placeholder = cardContainer.querySelector('.board-card-v2.drag-placeholder');
      let beforeItem = null;
      let afterItem = null;

      if (placeholder) {
        let index = 0;
        for (const card of cards) {
          const isAfter = placeholder.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING;
          if (isAfter) {
            afterItem = itemLookup.get(card.dataset.itemId) || null;
            if (index > 0) {
              beforeItem = itemLookup.get(cards[index - 1].dataset.itemId) || null;
            }
            break;
          }
          index++;
        }
        if (!afterItem && cards.length > 0) {
          beforeItem = itemLookup.get(cards[cards.length - 1].dataset.itemId) || null;
        }
      }
      return { beforeItem, afterItem };
    }

    function handleDragStart(e) {
      dragSrcId = this.dataset.itemId;
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrcId);
    }

    function handleDragEnd() {
      this.classList.remove('dragging');
      clearDragIndicators();
      dragSrcId = null;
      endDragAutoScroll();
    }

    function handleDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const cardContainer = getTargetContainer(e.currentTarget);
      const col = cardContainer?.closest('.board-column-v2');
      if (col && !col.classList.contains('drag-over')) {
        clearDragIndicators();
        col.classList.add('drag-over');
      }
      if (cardContainer) {
        updatePlaceholder(cardContainer, e.clientY);
        updateDragAutoScroll(e.clientY, cardContainer);
      }
    }

    function handleDragLeave(e) {
      const cardContainer = getTargetContainer(e.currentTarget);
      const col = cardContainer?.closest('.board-column-v2');
      if (col && !col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
        document.querySelectorAll('.board-card-v2.drag-placeholder').forEach(p => p.remove());
      }
    }

    function handleDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      endDragAutoScroll();
      const cardContainer = getTargetContainer(e.currentTarget);
      const col = cardContainer?.closest('.board-column-v2');
      if (!col) return;
      col.classList.remove('drag-over');

      const itemId = e.dataTransfer.getData('text/plain') || dragSrcId;
      const targetStatus = col.dataset.targetStatus;
      const item = itemLookup.get(itemId);
      if (!item || !targetStatus) return;

      const newOrder = computeDropOrder(cardContainer);
      const { beforeItem, afterItem } = resolveCardItems(cardContainer);

      if (typeof dragConfig.canDrop === 'function') {
        const allowed = dragConfig.canDrop({
          item,
          targetColumn: col,
          targetStatus,
          beforeItem,
          afterItem,
          fromStatus: item.status
        });
        if (!allowed) {
          clearDragIndicators();
          if (typeof dragConfig.onDropDenied === 'function') {
            dragConfig.onDropDenied({
              item,
              targetColumn: col,
              targetStatus,
              beforeItem,
              afterItem,
              fromStatus: item.status
            });
          }
          return;
        }
      }

      clearDragIndicators();
      dragConfig.onDrop({
        item,
        targetColumn: col,
        targetStatus,
        beforeItem,
        afterItem,
        newOrder,
        fromStatus: item.status
      });
    }

    // Build columns.
    let cardCounter = 0;
    columns.forEach(column => {
      const col = el('div', { class: 'board-column-v2', 'data-target-status': column.targetStatus || column.key });
      if (column.color) col.style.setProperty('--column-phase-color', column.color);

      // Resolve items for this column.
      let colItems = [];
      if (typeof getColumnKey === 'function') {
        colItems = items.filter(item => getColumnKey(item) === column.key);
      } else if (Array.isArray(column.statuses)) {
        colItems = items.filter(item => column.statuses.includes(item.status));
      } else if (typeof column.filter === 'function') {
        colItems = items.filter(item => column.filter(item));
      } else {
        colItems = items.filter(item => item.status === column.targetStatus || item.status === column.key);
      }

      // Header
      const header = el('div', { class: 'board-column-header-v2' });
      const titleWrap = el('div', { class: 'board-column-title' });
      const dotEl = el('span', { class: 'board-column-dot' });
      dotEl.innerHTML = buildColumnStatusIcon(column);
      titleWrap.appendChild(dotEl);
      titleWrap.appendChild(el('span', { class: 'board-column-label', text: column.label }));
      const columnTotal = Array.isArray(column.sections)
        ? column.sections.reduce((sum, s) => sum + (s.items?.length || 0), 0)
        : colItems.length;
      titleWrap.appendChild(el('span', { class: 'board-column-count', text: String(columnTotal) }));
      header.appendChild(titleWrap);

      const actionsWrap = el('div', { class: 'board-column-actions' });
      if (column.addButton) {
        const addBtn = el('button', {
          class: 'board-column-add',
          type: 'button',
          'aria-label': column.addButton.label || 'Add',
          html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
        });
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          column.addButton.onClick(column);
        });
        actionsWrap.appendChild(addBtn);
      }
      header.appendChild(actionsWrap);
      col.appendChild(header);

      // Card container
      const cardContainer = el('div', { class: 'board-cards-scroll' });
      if (column.cardContainerStyle) {
        Object.assign(cardContainer.style, column.cardContainerStyle);
      }

      if (dragConfig.enabled) {
        cardContainer.addEventListener('dragover', handleDragOver);
        cardContainer.addEventListener('dragleave', handleDragLeave);
        cardContainer.addEventListener('drop', handleDrop);
        col.addEventListener('dragover', handleDragOver);
        col.addEventListener('dragleave', handleDragLeave);
        col.addEventListener('drop', handleDrop);
      }

      // Helper to build and append a single card.
      const renderCardItem = (item, sectionColumn) => {
        const card = typeof renderCard === 'function'
          ? renderCard(item, sectionColumn || column, cardCounter++)
          : this.buildDefaultCard(item, sectionColumn || column, cardCounter++);
        if (!card) return;
        card.dataset.itemId = item.id;

        let hasCardMenu = false;
        if (cardMenuItems && typeof cardMenuItems === 'function') {
          const items = cardMenuItems(item, sectionColumn || column);
          if (items && items.length > 0) {
            this.attachCardMenu(card, items);
            hasCardMenu = true;
          }
        }
        if (!hasCardMenu) {
          const moreBtn = card.querySelector('.card-v2-menu');
          const moreWrap = card.querySelector('.card-v2-action-menu');
          if (moreBtn) moreBtn.style.display = 'none';
          if (moreWrap) moreWrap.style.display = 'none';
        }

        if (dragConfig.enabled) {
          const canDragItem = typeof dragConfig.canDrag === 'function' ? dragConfig.canDrag(item, sectionColumn || column) : true;
          if (canDragItem) {
            card.draggable = true;
            card.style.cursor = 'grab';
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragend', handleDragEnd);
          }
        }

        cardContainer.appendChild(card);
      };

      if (Array.isArray(column.sections) && column.sections.length > 0) {
        // Grouped column layout: each section has its own sticky phase header.
        col.classList.add('grouped');
        let hasAnyCard = false;

        column.sections.forEach((section, sectionIdx) => {
          const sectionColumn = { ...column, sectionKey: section.key, label: section.label || column.label };
          const secItems = section.items || [];
          if (secItems.length === 0 && column.emptyState !== false) return;

          hasAnyCard = hasAnyCard || secItems.length > 0;
          const sectionEl = el('div', { class: 'board-phase-section' });
          if (section.color) sectionEl.style.setProperty('--column-phase-color', section.color);

          const phaseHeader = el('div', { class: 'board-phase-header' });
          const phaseTitle = el('div', { class: 'board-phase-label' });
          const dotEl = el('span', { class: 'board-column-dot' });
          const rawIconHtml = section.icon
            ? (typeof section.icon === 'function' ? section.icon(section.color || column.color) : section.icon)
            : buildColumnStatusIcon({ key: section.key, color: section.color || column.color, icon: section.icon || 'phase' });
          const iconHtml = (typeof rawIconHtml === 'string' && rawIconHtml.trim().startsWith('<svg') && !rawIconHtml.includes('<script'))
            ? rawIconHtml
            : buildColumnStatusIcon({ key: section.key, color: section.color || column.color, icon: 'phase' });
          // Sanitize icon SVG to avoid XSS from column/section config.
          dotEl.textContent = '';
          const iconFragment = document.createRange().createContextualFragment(iconHtml);
          dotEl.appendChild(iconFragment);
          phaseTitle.appendChild(dotEl);
          phaseTitle.appendChild(el('span', { text: section.label || section.key }));
          phaseHeader.appendChild(phaseTitle);
          phaseHeader.appendChild(el('span', { class: 'board-phase-count', text: String(secItems.length) }));
          sectionEl.appendChild(phaseHeader);

          if (dragConfig.enabled) {
            sectionEl.addEventListener('dragover', handleDragOver);
            sectionEl.addEventListener('dragenter', handleDragEnter);
            sectionEl.addEventListener('dragleave', handleDragLeave);
            sectionEl.addEventListener('drop', (e) => handleDrop(e, sectionColumn));
          }

          if (secItems.length === 0) {
            const emptyCfg = typeof column.emptyState === 'function'
              ? column.emptyState(sectionColumn)
              : (column.emptyState || { variant: 'compact', title: `No ${(section.label || section.key).toLowerCase()}`, body: '' });
            sectionEl.appendChild(renderEmptyStateV2(emptyCfg));
          } else {
            secItems.forEach(item => renderCardItem(item, sectionColumn));
          }

          cardContainer.appendChild(sectionEl);
        });

        if (!hasAnyCard && column.emptyState !== false) {
          const emptyCfg = typeof column.emptyState === 'function'
            ? column.emptyState(column)
            : (column.emptyState || { variant: 'compact', title: `No ${column.label.toLowerCase()}`, body: '' });
          cardContainer.appendChild(renderEmptyStateV2(emptyCfg));
        }
      } else {
        // Optional add-card placeholder at the top of the column.
        if (column.addCard) {
          const addCard = el('div', {
            class: 'board-card-v2 add-card',
            style: column.addCard.style || 'background: transparent; border: 1px dashed var(--color-border); display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; font-weight: 600; color: var(--color-text-muted); margin-bottom: var(--spacing-sm, 12px); cursor: pointer; border-radius: 12px;'
          });
          addCard.innerHTML = (column.addCard.icon || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>') + ' ' + escapeHtml(column.addCard.label || 'Add');
          addCard.addEventListener('click', () => column.addCard.onClick(column));
          cardContainer.appendChild(addCard);
        }

        // Empty state inside column when appropriate.
        const showEmpty = column.emptyState !== false && colItems.length === 0;
        if (showEmpty) {
          const emptyCfg = typeof column.emptyState === 'function'
            ? column.emptyState(column)
            : (column.emptyState || { variant: 'compact', title: `No ${column.label.toLowerCase()}`, body: '' });
          cardContainer.appendChild(renderEmptyStateV2(emptyCfg));
        }

        // Cards
        colItems.forEach(item => renderCardItem(item, column));
      }

      col.appendChild(cardContainer);
      board.appendChild(col);
    });

    if (items.length === 0 && typeof onEmpty === 'function') {
      const empty = onEmpty();
      if (empty) {
        board.innerHTML = '';
        board.appendChild(empty);
      }
    }

    if (container) {
      container.innerHTML = '';
      container.appendChild(board);
    }
    return board;
  },

  buildDefaultCard(item, column, idx) {
    return buildCompactBoardCard({
      key: String(idx + 1),
      title: item.title || item.name || item.id || 'Untitled',
      description: column.label,
      onClick: () => {}
    });
  },

  attachCardMenu(card, items) {
    const moreWrap = card.querySelector('.card-v2-action-menu');
    const moreBtn = card.querySelector('.card-v2-menu');
    if (!moreWrap || !moreBtn) return;

    let menu = moreWrap.querySelector('.action-menu-list');
    if (!menu) {
      menu = el('div', { class: 'action-menu-list hidden' });
      moreWrap.appendChild(menu);
    }
    // Rebuild items each time so stale closures are not an issue.
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.innerHTML = '';
      items.forEach(mi => {
        if (mi === null || mi === undefined) return;
        const btn = el('button', {
          type: 'button',
          class: 'action-menu-item ' + (mi.className || ''),
          html: (mi.icon || '') + ' ' + escapeHtml(mi.label)
        });
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          toggleMenu(menu, moreBtn);
          mi.onClick(ev);
        });
        menu.appendChild(btn);
      });
      toggleMenu(menu, moreBtn);
    });
  },

  /**
   * Wire drag-and-drop for an external board layout (e.g. grouped Operations board
   * columns) using the same midpoint boardOrder and placeholder behavior as
   * KanbanBoard.render. The caller provides the root element, item array, and a
   * drag config with canDrag/canDrop/onDrop callbacks.
   */
  attachDrag(config = {}) {
    const {
      root,
      items = [],
      drag = {},
      columnSelector = '.board-group-column',
      cardContainerSelector = '.board-group-column',
      cardSelector = '.board-card-v2.compact'
    } = config;

    const dragConfig = {
      enabled: true,
      canDrag: () => true,
      canDrop: () => true,
      orderField: 'boardOrder',
      onDropDenied: () => {},
      ...drag
    };

    if (!dragConfig.enabled || !root) return;

    const itemLookup = new Map();
    items.forEach(item => itemLookup.set(item.id, item));

    let dragSrcId = null;
    let autoScrollContainer = null;
    let autoScrollDir = 0;
    let autoScrollRaf = null;
    let autoScrollDist = Infinity;
    const SCROLL_MARGIN = 80;
    const SCROLL_SPEED = 20;
    const SCROLL_MAX_SPEED = 55;

    const columns = Array.from(root.querySelectorAll(columnSelector));

    const getCardContainerCards = container =>
      Array.from(container.querySelectorAll(cardSelector)).filter(c =>
        !c.classList.contains('dragging') &&
        !c.classList.contains('drag-placeholder') &&
        !c.classList.contains('add-card')
      );

    const clearDragIndicators = () => {
      columns.forEach(c => c.classList.remove('drag-over'));
      root.querySelectorAll('.board-card-v2.drag-placeholder').forEach(p => p.remove());
    };

    const getDragPlaceholder = () => {
      let placeholder = root.querySelector('.board-card-v2.drag-placeholder');
      if (!placeholder) {
        placeholder = el('div', { class: 'board-card-v2 compact drag-placeholder' });
      }
      return placeholder;
    };

    const updatePlaceholder = (cardContainer, y) => {
      const draggedId = dragSrcId;
      const cards = getCardContainerCards(cardContainer);
      const placeholder = getDragPlaceholder();

      if (cards.length === 0) {
        cardContainer.appendChild(placeholder);
        return;
      }

      let targetCard = null;
      for (const card of cards) {
        if (card.dataset.itemId === draggedId) continue;
        const rect = card.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (y < mid) {
          targetCard = card;
          break;
        }
      }
      if (targetCard) cardContainer.insertBefore(placeholder, targetCard);
      else cardContainer.appendChild(placeholder);
    };

    const computeDropOrder = (cardContainer) => {
      const orderField = dragConfig.orderField;
      const cards = getCardContainerCards(cardContainer);
      if (cards.length === 0) return 1000;

      const placeholder = cardContainer.querySelector('.board-card-v2.drag-placeholder');
      let targetIndex = cards.length;
      if (placeholder) {
        let index = 0;
        for (const card of cards) {
          if (placeholder.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) {
            targetIndex = index;
            break;
          }
          index++;
        }
      }

      const getOrder = id => {
        const item = itemLookup.get(id);
        return typeof item?.[orderField] === 'number' ? item[orderField] : null;
      };

      if (targetIndex === 0) {
        const firstOrder = getOrder(cards[0].dataset.itemId);
        return (firstOrder ?? 1000) / 2;
      }
      if (targetIndex >= cards.length) {
        const lastOrder = getOrder(cards[cards.length - 1].dataset.itemId);
        return (lastOrder ?? cards.length * 1000) + 1000;
      }
      const beforeOrder = getOrder(cards[targetIndex - 1].dataset.itemId) ?? targetIndex * 1000;
      const afterOrder = getOrder(cards[targetIndex].dataset.itemId) ?? (targetIndex + 1) * 1000;
      return (beforeOrder + afterOrder) / 2;
    };

    const resolveCardItems = (cardContainer) => {
      const cards = getCardContainerCards(cardContainer);
      const placeholder = cardContainer.querySelector('.board-card-v2.drag-placeholder');
      let beforeItem = null;
      let afterItem = null;

      if (placeholder) {
        let index = 0;
        for (const card of cards) {
          const isAfter = placeholder.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING;
          if (isAfter) {
            afterItem = itemLookup.get(card.dataset.itemId) || null;
            if (index > 0) {
              beforeItem = itemLookup.get(cards[index - 1].dataset.itemId) || null;
            }
            break;
          }
          index++;
        }
        if (!afterItem && cards.length > 0) {
          beforeItem = itemLookup.get(cards[cards.length - 1].dataset.itemId) || null;
        }
      }
      return { beforeItem, afterItem };
    };

    const beginDragAutoScroll = () => {
      const step = () => {
        if (!autoScrollDir || !autoScrollContainer) {
          autoScrollRaf = null;
          return;
        }
        const speed = Math.min(SCROLL_MAX_SPEED, SCROLL_SPEED + (autoScrollDist / SCROLL_MARGIN) * 10);
        autoScrollContainer.scrollTop += autoScrollDir * speed;
        autoScrollRaf = requestAnimationFrame(step);
      };
      autoScrollRaf = requestAnimationFrame(step);
    };

    const updateDragAutoScroll = (clientY, container) => {
      const rect = container.getBoundingClientRect();
      const distTop = clientY - rect.top;
      const distBottom = rect.bottom - clientY;
      let dir = 0;
      let dist = Infinity;
      if (distTop < SCROLL_MARGIN) { dir = -1; dist = distTop; }
      else if (distBottom < SCROLL_MARGIN) { dir = 1; dist = distBottom; }

      autoScrollContainer = container;
      autoScrollDir = dir;
      autoScrollDist = dist;
      if (dir && !autoScrollRaf) beginDragAutoScroll();
      else if (!dir && autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
    };

    const endDragAutoScroll = () => {
      autoScrollDir = 0;
      autoScrollDist = Infinity;
      autoScrollContainer = null;
      if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
    };

    const handleDragStart = function(e) {
      dragSrcId = this.dataset.itemId;
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrcId);
    };

    const handleDragEnd = function() {
      this.classList.remove('dragging');
      clearDragIndicators();
      dragSrcId = null;
      endDragAutoScroll();
    };

    const handleDragOver = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const column = e.currentTarget;
      const cardContainer = column.querySelector(cardContainerSelector) || column;
      if (!column.classList.contains('drag-over')) {
        clearDragIndicators();
        column.classList.add('drag-over');
      }
      updatePlaceholder(cardContainer, e.clientY);
      updateDragAutoScroll(e.clientY, cardContainer);
    };

    const handleDragLeave = (e) => {
      const column = e.currentTarget;
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove('drag-over');
        column.querySelectorAll('.board-card-v2.drag-placeholder').forEach(p => p.remove());
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      endDragAutoScroll();
      const column = e.currentTarget;
      const cardContainer = column.querySelector(cardContainerSelector) || column;
      column.classList.remove('drag-over');

      const itemId = e.dataTransfer.getData('text/plain') || dragSrcId;
      const targetStatus = column.dataset.targetStatus;
      const item = itemLookup.get(itemId);
      if (!item || !targetStatus) return;

      const newOrder = computeDropOrder(cardContainer);
      const { beforeItem, afterItem } = resolveCardItems(cardContainer);

      if (typeof dragConfig.canDrop === 'function') {
        const allowed = dragConfig.canDrop({
          item,
          targetColumn: column,
          targetStatus,
          beforeItem,
          afterItem,
          fromStatus: item.status
        });
        if (!allowed) {
          clearDragIndicators();
          if (typeof dragConfig.onDropDenied === 'function') {
            dragConfig.onDropDenied({
              item,
              targetColumn: column,
              targetStatus,
              beforeItem,
              afterItem,
              fromStatus: item.status
            });
          }
          return;
        }
      }

      clearDragIndicators();
      dragConfig.onDrop({
        item,
        targetColumn: column,
        targetStatus,
        beforeItem,
        afterItem,
        newOrder,
        fromStatus: item.status
      });
    };

    columns.forEach(column => {
      column.addEventListener('dragover', handleDragOver);
      column.addEventListener('dragleave', handleDragLeave);
      column.addEventListener('drop', handleDrop);
    });

    root.querySelectorAll(cardSelector).forEach(card => {
      const itemId = card.dataset.itemId;
      if (!itemId) return;
      const canDragItem = typeof dragConfig.canDrag === 'function'
        ? dragConfig.canDrag(itemLookup.get(itemId), card.closest(columnSelector))
        : true;
      if (canDragItem) {
        card.draggable = true;
        card.style.cursor = 'grab';
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
      }
    });
  },

  closeAllMenus,
  toggleMenu,
  renderEmptyStateV2
};
