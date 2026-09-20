// DOM rendering and interaction. Never imported by tests.
import { POSITIONS, BENCH, posData, escapeHtml, formatTime } from './positions.js';
import { getLiveTimes } from './state.js';
import {
    getCurrentSlot, getPlannedSlot, getPlannedChanges,
    getSortedOnField, getSortedBench, arePositionsActive
} from './plan.js';

const $ = id => document.getElementById(id);
const els = {
    stopwatch: $('stopwatch'),
    shortestStint: $('shortest-stint'),
    toggleBtn: $('toggle-btn'),
    onFieldList: $('on-field-list'),
    onFieldHeader: $('on-field-header'),
    benchList: $('bench-list'),
    benchHeader: $('bench-header'),
    adminToggle: $('admin-toggle'),
    adminContent: $('admin-content'),
    rosterList: $('roster-list'),
    playerNameInput: $('player-name'),
    planSection: $('plan-section'),
    planBadge: $('plan-badge'),
    planContent: $('plan-content'),
    planToggleIcon: $('plan-toggle-icon'),
    planGrid: $('plan-grid'),
    planArrowsSvg: $('plan-arrows-svg'),
    planArrowsPaths: $('plan-arrows-paths')
};

export function isDragInProgress() {
    return dragState.activeId !== null;
}

// --- Plan row layout ---

export function getPlanRows(state) {
    if (arePositionsActive(state)) {
        const rows = [
            { id: 'Goalie', label: 'Goalie', class: 'pos-g' },
            { id: 'Defense', label: 'Defense', class: 'pos-d' },
            { id: 'Midfield', label: 'Midfield', class: 'pos-m' },
            { id: 'Offense', label: 'Offense', class: 'pos-o' }
        ];
        if (state.roster.some(p => p.isPresent && (getCurrentSlot(p) === 'Unassigned' || getPlannedSlot(state, p) === 'Unassigned'))) {
            rows.push({ id: 'Unassigned', label: 'Unassigned', class: 'pos-u' });
        }
        rows.push({ id: BENCH, label: 'Bench', class: 'plan-pos-tag-bench' });
        return rows;
    }
    return [
        { id: 'Unassigned', label: 'On Field', class: 'plan-pos-tag-field' },
        { id: BENCH, label: 'Bench', class: 'plan-pos-tag-bench' }
    ];
}

// --- Rendering ---

export function render(state, { updatePlanGrid = true } = {}) {
    const { gameTime, playerTimes, stintTimes, benchTimes, goalieTimes } = getLiveTimes(state);

    els.stopwatch.textContent = formatTime(gameTime);
    els.toggleBtn.textContent = state.gameRunning ? 'Pause' : 'Start';
    els.toggleBtn.className = state.gameRunning ? 'btn-secondary' : 'btn-primary';

    const onField = getSortedOnField(state, stintTimes);
    const bench = getSortedBench(state, playerTimes, benchTimes);

    if (onField.length > 0) {
        els.onFieldHeader.classList.remove('hidden');
        els.onFieldHeader.classList.add('has-stint');
    } else {
        els.onFieldHeader.classList.add('hidden');
    }
    els.benchHeader.classList.toggle('hidden', bench.length === 0);

    const minStint = onField.length > 0
        ? Math.min(...onField.map(p => stintTimes[p.id]))
        : null;
    els.shortestStint.textContent = minStint === null ? '--:--' : formatTime(minStint);

    renderPlayerList(els.onFieldList, state, onField, playerTimes, stintTimes, 'on-field-card', goalieTimes);
    renderPlayerList(els.benchList, state, bench, playerTimes, benchTimes, 'bench-card', goalieTimes);
    renderPlan(state, updatePlanGrid);

    // Admin roster (only rebuild when structure changes, not on clock ticks)
    if (updatePlanGrid) {
        els.rosterList.innerHTML = '';
        state.roster.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${escapeHtml(p.name)}</span>
                <div class="roster-actions">
                    <input type="checkbox" class="presence-checkbox" data-id="${p.id}" ${p.isPresent ? 'checked' : ''}>
                    <button class="remove-player-btn" data-id="${p.id}">✕</button>
                </div>
            `;
            els.rosterList.appendChild(li);
        });

        if (state.roster.length === 0) {
            els.adminContent.classList.remove('hidden');
            els.adminToggle.classList.add('hidden');
        } else {
            els.adminToggle.classList.remove('hidden');
        }
    }
}

function renderPlayerList(container, state, players, times, secondaryTimes, cardClass, goalieTimes) {
    container.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-card ${cardClass}`;

        if (p.needsFlash) {
            div.classList.add('flash-update');
            delete p.needsFlash;
        }

        const isRunning = state.gameRunning && p.onField;
        const goalieMins = Math.round((goalieTimes[p.id] || 0) / 60000);
        const goalieHtml = goalieMins > 0
            ? `<span class="goalie-pill" title="Goalie Time: ${formatTime(goalieTimes[p.id])}">G ${goalieMins}m</span>`
            : '';

        // Planned change badge (only if planned position differs from current)
        let plannedBadgeHtml = '';
        if (state.subPlan) {
            const currentPos = getCurrentSlot(p);
            const plannedPos = getPlannedSlot(state, p);
            if (plannedPos !== currentPos) {
                if (plannedPos === BENCH) {
                    plannedBadgeHtml = `<span class="planned-change-badge queue-badge-out" title="Planned: Bench">➔ 🪑</span>`;
                } else {
                    const target = posData(plannedPos);
                    plannedBadgeHtml = `<span class="planned-change-badge ${target.class}" title="Planned: ${escapeHtml(plannedPos)}">➔ ${target.short}</span>`;
                }
            }
        }

        let secondaryHtml = '';
        let posHtml = '';
        if (p.onField) {
            const pos = posData(p.position);
            posHtml = `<div class="pos-btn ${pos.class}" data-id="${p.id}">${pos.short}</div>`;
            secondaryHtml = `<span class="player-time stint-time" title="Current Stint">${formatTime(secondaryTimes[p.id])}</span>`;
            div.classList.add('has-stint');
        } else {
            secondaryHtml = `<span class="player-time bench-time" title="Time on Bench">${formatTime(secondaryTimes[p.id])}</span>`;
        }

        div.innerHTML = `
            <span class="player-name"><span class="player-name-text">${escapeHtml(p.name)}</span>${goalieHtml}${plannedBadgeHtml}</span>
            ${posHtml}
            <span class="player-time ${isRunning ? 'pulsing' : ''}" title="Total Time">${formatTime(times[p.id])}</span>
            ${secondaryHtml}
            <button class="sub-btn ${p.onField ? 'btn-secondary' : 'btn-primary'}" data-id="${p.id}">${p.onField ? 'Sub Out' : 'Sub In'}</button>
        `;
        container.appendChild(div);
    });
}

function renderPlan(state, updatePlanGrid = true) {
    if (!els.planSection) return;

    els.planContent.classList.toggle('hidden', !state.planExpanded);
    els.planToggleIcon.classList.toggle('expanded', state.planExpanded);

    const changes = getPlannedChanges(state);
    if (changes.length > 0) {
        els.planBadge.textContent = `${changes.length} ${changes.length === 1 ? 'move' : 'moves'}`;
        els.planBadge.classList.remove('hidden');
    } else {
        els.planBadge.classList.add('hidden');
    }

    if (!state.planExpanded || !updatePlanGrid) return;

    const rows = getPlanRows(state);
    els.planGrid.innerHTML = '';
    rows.forEach(row => {
        const currentPlayers = state.roster.filter(p => p.isPresent && getCurrentSlot(p) === row.id);
        const plannedPlayers = state.roster.filter(p => p.isPresent && getPlannedSlot(state, p) === row.id);

        const leftChipsHtml = currentPlayers.map(p =>
            `<div class="plan-chip plan-chip-left" data-player-id="${p.id}">${escapeHtml(p.name)}</div>`
        ).join('');
        const rightChipsHtml = plannedPlayers.map(p =>
            `<div class="plan-chip plan-chip-right" draggable="true" data-player-id="${p.id}">${escapeHtml(p.name)}</div>`
        ).join('');

        const rowDiv = document.createElement('div');
        rowDiv.className = 'plan-pos-row';
        rowDiv.innerHTML = `
            <div class="plan-cell plan-cell-left">
                <div class="plan-cell-header">
                    <span class="plan-pos-tag ${row.class}">${escapeHtml(row.label)}</span>
                </div>
                <div class="plan-chips-container">${leftChipsHtml}</div>
            </div>
            <div class="plan-row-spacer"></div>
            <div class="plan-cell plan-cell-right plan-drop-zone" data-pos="${row.id}">
                <div class="plan-cell-header">
                    <span class="plan-pos-tag ${row.class}">${escapeHtml(row.label)}</span>
                </div>
                <div class="plan-chips-container">${rightChipsHtml}</div>
            </div>
        `;
        els.planGrid.appendChild(rowDiv);
    });

    setupPlanDragAndDrop(planMoveHandler);
    requestAnimationFrame(() => drawPlanArrows(state));
}

// Callback invoked when a chip is dropped on a zone; registered from main.js.
let planMoveHandler = () => {};
export function setPlanMoveHandler(fn) {
    planMoveHandler = fn;
}

function drawPlanArrows(state) {
    if (!state.planExpanded || !els.planArrowsSvg || !els.planGrid) return;

    const svgRect = els.planArrowsSvg.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) return;

    const changes = getPlannedChanges(state);
    let pathsHtml = '';

    changes.forEach(p => {
        const leftEl = els.planGrid.querySelector(`.plan-chip-left[data-player-id="${p.id}"]`);
        const rightEl = els.planGrid.querySelector(`.plan-chip-right[data-player-id="${p.id}"]`);
        if (!leftEl || !rightEl) return;

        const rLeft = leftEl.getBoundingClientRect();
        const rRight = rightEl.getBoundingClientRect();

        const x1 = rLeft.right - svgRect.left;
        const y1 = rLeft.top + rLeft.height / 2 - svgRect.top;
        const x2 = rRight.left - svgRect.left;
        const y2 = rRight.top + rRight.height / 2 - svgRect.top;

        const dx = Math.max(25, (x2 - x1) * 0.45);
        const targetPos = getPlannedSlot(state, p);
        const color = posData(targetPos).color;

        pathsHtml += `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" class="plan-arrow-path" stroke="${color}" marker-end="url(#arrow-${targetPos.toLowerCase()})"/>`;
    });

    const pathsGroup = els.planArrowsPaths || els.planArrowsSvg.querySelector('#plan-arrows-paths');
    if (pathsGroup) {
        pathsGroup.innerHTML = pathsHtml;
    } else {
        const defsEl = els.planArrowsSvg.querySelector('defs');
        const defsHtml = defsEl ? defsEl.outerHTML : '';
        els.planArrowsSvg.innerHTML = defsHtml + pathsHtml;
    }
}

export function redrawArrows(state) {
    drawPlanArrows(state);
}

// --- Plan drag & drop (native + touch) ---

const dragState = { activeId: null, clone: null };

// Reference to the live app state, set once from main.js (dialog needs roster lookup).
let currentRosterRef = { roster: [] };
export function bindStateRef(state) {
    currentRosterRef = state;
}

export function setupPlanDragAndDrop(onMove) {
    const chips = els.planGrid.querySelectorAll('.plan-chip-right');
    chips.forEach(chip => {
        chip.addEventListener('dragstart', (e) => {
            dragState.activeId = chip.dataset.playerId;
            e.dataTransfer.setData('text/plain', chip.dataset.playerId);
            e.dataTransfer.effectAllowed = 'move';
            chip.classList.add('dragging');
        });

        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            dragState.activeId = null;
            els.planGrid.querySelectorAll('.plan-drop-zone').forEach(z => z.classList.remove('drag-over'));
        });

        chip.addEventListener('touchstart', (e) => handleTouchStart(e, chip, onMove), { passive: false });
    });

    const dropZones = els.planGrid.querySelectorAll('.plan-drop-zone');
    dropZones.forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const playerId = e.dataTransfer.getData('text/plain') || dragState.activeId;
            const targetPos = zone.dataset.pos;
            if (playerId && targetPos) onMove(playerId, targetPos);
        });
    });
}

function handleTouchStart(e, chip, onMove) {
    const playerId = chip.dataset.playerId;
    const touch = e.touches[0];
    dragState.activeId = playerId;

    const startX = touch.clientX;
    const startY = touch.clientY;
    let isDragging = false;

    function onTouchMove(moveEvent) {
        const moveTouch = moveEvent.touches[0];
        const dx = moveTouch.clientX - startX;
        const dy = moveTouch.clientY - startY;

        if (!isDragging && Math.hypot(dx, dy) > 8) {
            isDragging = true;
            chip.classList.add('dragging');
            dragState.clone = chip.cloneNode(true);
            Object.assign(dragState.clone.style, {
                position: 'fixed',
                pointerEvents: 'none',
                zIndex: '1000',
                opacity: '0.85',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
            });
            document.body.appendChild(dragState.clone);
        }

        if (isDragging) {
            moveEvent.preventDefault();
            dragState.clone.style.left = `${moveTouch.clientX - dragState.clone.offsetWidth / 2}px`;
            dragState.clone.style.top = `${moveTouch.clientY - dragState.clone.offsetHeight / 2}px`;

            const elemUnder = document.elementFromPoint(moveTouch.clientX, moveTouch.clientY);
            const zone = elemUnder ? elemUnder.closest('.plan-drop-zone') : null;
            els.planGrid.querySelectorAll('.plan-drop-zone').forEach(z => {
                z.classList.toggle('drag-over', z === zone);
            });
        }
    }

    function onTouchEnd(endEvent) {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        document.removeEventListener('touchcancel', onTouchEnd);

        if (dragState.clone) {
            dragState.clone.remove();
            dragState.clone = null;
        }
        chip.classList.remove('dragging');

        if (isDragging) {
            const endTouch = endEvent.changedTouches[0];
            const elemUnder = document.elementFromPoint(endTouch.clientX, endTouch.clientY);
            const zone = elemUnder ? elemUnder.closest('.plan-drop-zone') : null;
            els.planGrid.querySelectorAll('.plan-drop-zone').forEach(z => z.classList.remove('drag-over'));
            if (zone && dragState.activeId) onMove(dragState.activeId, zone.dataset.pos);
        }
        dragState.activeId = null;
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
}

// --- Position dialog + long press ---

const dialog = {
    el: $('position-dialog'),
    options: $('position-options'),
    closeBtn: $('close-dialog'),
    timer: null,
    wasLongPress: false,
    playerId: null
};

export function initPositionDialog(onCycle, onSet) {
    dialog.closeBtn.onclick = () => dialog.el.close();

    let startX = 0;
    let startY = 0;

    document.addEventListener('pointerdown', (e) => {
        if (!e.target.classList.contains('pos-btn')) return;
        dialog.wasLongPress = false;
        startX = e.clientX;
        startY = e.clientY;
        const id = e.target.dataset.id;
        dialog.timer = setTimeout(() => {
            dialog.wasLongPress = true;
            openPositionDialog(id, onSet);
        }, 800);
    });

    // Cancel long press only if movement exceeds jitter threshold (10px).
    document.addEventListener('pointermove', (e) => {
        if (dialog.timer) {
            const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
            if (dist > 10) {
                cancelLongPress();
            }
        }
    });

    ['pointerup', 'pointercancel'].forEach(evt =>
        document.addEventListener(evt, cancelLongPress)
    );

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('pos-btn')) {
            if (dialog.wasLongPress) return; // ignore click that followed a long press
            onCycle(e.target.dataset.id);
        }
    });
}

function cancelLongPress() {
    if (dialog.timer) {
        clearTimeout(dialog.timer);
        dialog.timer = null;
    }
}

function openPositionDialog(id, onSet) {
    dialog.playerId = id;
    const player = currentRosterRef.roster.find(p => p.id === id);
    if (!player) return;
    dialog.options.innerHTML = '';
    POSITIONS.forEach(pos => {
        const btn = document.createElement('button');
        btn.innerHTML = pos === 'Unassigned'
            ? `<strong>-</strong> Unassigned`
            : `<strong>${pos.charAt(0)}</strong> ${pos.slice(1)}`;
        if (player.position === pos) btn.style.borderColor = 'var(--primary)';
        btn.onclick = () => {
            onSet(id, pos);
            dialog.el.close();
        };
        dialog.options.appendChild(btn);
    });
    dialog.el.showModal();
}

export function initPlanResizeObserver(state) {
    if (typeof ResizeObserver !== 'undefined' && els.planGrid) {
        const ro = new ResizeObserver(() => {
            if (state.planExpanded) {
                redrawArrows(state);
            }
        });
        ro.observe(els.planGrid);
    }
}
