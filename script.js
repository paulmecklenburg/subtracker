// State Management
const POSITIONS = ['Unassigned', 'Goalie', 'Defense', 'Midfield', 'Offense'];

let state = {
    gameRunning: false,
    accumulatedGameTime: 0,
    lastSyncTimestamp: null,
    lastUpdate: Date.now(),
    roster: [], // { id, name, onField: false, totalPlayTime: 0, goaliePlayTime: 0, currentStintTime: 0, lastSubOutGameTime: 0, isPresent: true, position: 'Unassigned' }
    subPlan: null, // { [playerId]: 'Goalie'|'Defense'|'Midfield'|'Offense'|'Unassigned'|'Bench' }
    planExpanded: false
};

const STORAGE_KEY = 'subtracker_state';

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        const parsed = JSON.parse(saved);
        // Auto-reset if more than 24 hours
        if (Date.now() - parsed.lastUpdate > 24 * 60 * 60 * 1000) {
            parsed.accumulatedGameTime = 0;
            parsed.gameRunning = false;
            parsed.lastSyncTimestamp = null;
            parsed.subPlan = null;
            parsed.planExpanded = false;
            parsed.roster.forEach(p => {
                p.totalPlayTime = 0;
                p.goaliePlayTime = 0;
                p.currentStintTime = 0;
                p.lastSubOutGameTime = 0;
                p.onField = false;
                p.position = 'Unassigned';
            });
        }
        state = parsed;
        if (state.subPlan && typeof state.subPlan !== 'object') {
            state.subPlan = null;
        }
        if (state.planExpanded === undefined) {
            state.planExpanded = false;
        }
        // Migration: Ensure all players have needed properties
        state.roster.forEach(p => {
            if (p.isPresent === undefined) p.isPresent = true;
            if (p.currentStintTime === undefined) p.currentStintTime = 0;
            if (p.lastSubOutGameTime === undefined) p.lastSubOutGameTime = 0;
            if (p.goaliePlayTime === undefined) p.goaliePlayTime = 0;
            if (p.position === undefined) p.position = 'Unassigned';
        });
    }
}

function saveState() {
    state.lastUpdate = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Time calculation
function getLiveTimes() {
    const now = Date.now();
    const delta = (state.gameRunning && state.lastSyncTimestamp) ? (now - state.lastSyncTimestamp) : 0;
    const gameTime = Math.max(0, state.accumulatedGameTime + delta);
    
    return {
        gameTime,
        playerTimes: state.roster.reduce((acc, p) => {
            const isOutfield = state.gameRunning && p.onField && p.position !== 'Goalie';
            acc[p.id] = Math.max(0, p.totalPlayTime + (isOutfield ? delta : 0));
            return acc;
        }, {}),
        goalieTimes: state.roster.reduce((acc, p) => {
            const isGoalie = state.gameRunning && p.onField && p.position === 'Goalie';
            acc[p.id] = Math.max(0, (p.goaliePlayTime || 0) + (isGoalie ? delta : 0));
            return acc;
        }, {}),
        stintTimes: state.roster.reduce((acc, p) => {
            acc[p.id] = Math.max(0, p.currentStintTime + (state.gameRunning && p.onField ? delta : 0));
            return acc;
        }, {}),
        benchTimes: state.roster.reduce((acc, p) => {
            acc[p.id] = (!p.onField && p.isPresent) ? Math.max(0, gameTime - (p.lastSubOutGameTime || 0)) : 0;
            return acc;
        }, {})
    };
}

function syncState() {
    if (state.gameRunning && state.lastSyncTimestamp) {
        const now = Date.now();
        const delta = now - state.lastSyncTimestamp;
        state.accumulatedGameTime += delta;
        state.roster.forEach(p => {
            if (p.onField) {
                if (p.position === 'Goalie') {
                    p.goaliePlayTime = (p.goaliePlayTime || 0) + delta;
                } else {
                    p.totalPlayTime += delta;
                }
                p.currentStintTime += delta;
            }
        });
        state.lastSyncTimestamp = now;
    }
}

// UI Formatting
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// DOM Elements
const stopwatchEl = document.getElementById('stopwatch');
const shortestStintEl = document.getElementById('shortest-stint');
const toggleBtn = document.getElementById('toggle-btn');
const onFieldListEl = document.getElementById('on-field-list');
const onFieldHeaderEl = document.getElementById('on-field-header');
const benchListEl = document.getElementById('bench-list');
const benchHeaderEl = document.getElementById('bench-header');
const adminToggle = document.getElementById('admin-toggle');
const adminContent = document.getElementById('admin-content');
const rosterListEl = document.getElementById('roster-list');
const playerNameInput = document.getElementById('player-name');
const addBtn = document.getElementById('add-btn');
const resetBtn = document.getElementById('reset-btn');
const rewindBtn = document.getElementById('rewind-btn');
const fastForwardBtn = document.getElementById('fast-forward-btn');

// Substitution Plan DOM Elements
const planSectionEl = document.getElementById('plan-section');
const planHeaderEl = document.getElementById('plan-header');
const planToggleIcon = document.getElementById('plan-toggle-icon');
const planBadgeEl = document.getElementById('plan-badge');
const planContentEl = document.getElementById('plan-content');
const planGridEl = document.getElementById('plan-grid');
const planArrowsSvg = document.getElementById('plan-arrows-svg');
const planExecuteBtn = document.getElementById('plan-execute-btn');
const planResetBtn = document.getElementById('plan-reset-btn');
const planClearBtn = document.getElementById('plan-clear-btn');

function performActionAndFlashIfMoved(action) {
    const { stintTimes } = getLiveTimes();
    const oldOrder = getSortedOnField(stintTimes).map(p => p.id);
    
    action();
    
    const newOrder = getSortedOnField(stintTimes).map(p => p.id);
    
    // Only flash if the list order actually changed
    if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
        newOrder.forEach((id, index) => {
            if (oldOrder[index] !== id) {
                const player = state.roster.find(r => r.id === id);
                if (player) player.needsFlash = true;
            }
        });
    }
}

// Substitution Plan Logic
function arePositionsActive() {
    return state.roster.some(p => p.onField && p.isPresent && p.position && p.position !== 'Unassigned');
}

function getPlannedChanges() {
    if (!state.subPlan) return [];
    return state.roster.filter(p => {
        if (!p.isPresent) return false;
        const current = p.onField ? (p.position || 'Unassigned') : 'Bench';
        const planned = state.subPlan[p.id] !== undefined ? state.subPlan[p.id] : current;
        return planned !== current;
    });
}

function generateDefaultSubPlan() {
    syncState();
    const { playerTimes, stintTimes, benchTimes } = getLiveTimes();
    const onField = state.roster.filter(p => p.onField && p.isPresent);
    const bench = getSortedBench(playerTimes, benchTimes);

    const newPlan = {};
    state.roster.forEach(p => {
        if (p.isPresent) {
            newPlan[p.id] = p.onField ? (p.position || 'Unassigned') : 'Bench';
        }
    });

    if (onField.length > 0 && bench.length > 0) {
        if (arePositionsActive()) {
            const offensePlayers = onField.filter(p => p.position === 'Offense')
                .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));

            const eligibleOnField = onField.filter(p => p.position !== 'Goalie')
                .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));

            const candidateOut = offensePlayers.length > 0 ? offensePlayers : eligibleOnField;
            const numSubs = Math.min(candidateOut.length, bench.length);

            const subsOut = candidateOut.slice(0, numSubs);
            const subsIn = bench.slice(0, numSubs);

            // Offense -> Bench
            subsOut.forEach(p => {
                newPlan[p.id] = 'Bench';
            });

            // Bench -> Defense
            subsIn.forEach(p => {
                newPlan[p.id] = 'Defense';
            });

            // Field shifts: Defense -> Midfield, Midfield -> Offense (Goalie and Unassigned remain)
            onField.forEach(p => {
                if (subsOut.some(s => s.id === p.id)) return;
                if (p.position === 'Goalie' || p.position === 'Unassigned') return;

                if (p.position === 'Defense') {
                    newPlan[p.id] = 'Midfield';
                } else if (p.position === 'Midfield') {
                    newPlan[p.id] = 'Offense';
                }
            });
        } else {
            // Positions not actively in use: rotate onField <-> Bench
            const numSubs = Math.min(onField.length, bench.length);
            const subsOut = onField.sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0)).slice(0, numSubs);
            const subsIn = bench.slice(0, numSubs);

            subsOut.forEach(p => {
                newPlan[p.id] = 'Bench';
            });
            subsIn.forEach(p => {
                newPlan[p.id] = 'Unassigned';
            });
        }
    }

    state.subPlan = newPlan;
    saveState();
    render();
}

function executeSubPlan() {
    if (!state.subPlan) return;
    syncState();
    const execTime = state.accumulatedGameTime;

    state.roster.forEach(p => {
        if (!p.isPresent) return;
        const current = p.onField ? (p.position || 'Unassigned') : 'Bench';
        const target = state.subPlan[p.id] !== undefined ? state.subPlan[p.id] : current;
        if (target === current) return;

        if (target === 'Bench') {
            p.onField = false;
            p.lastSubOutGameTime = execTime;
        } else {
            if (!p.onField) {
                const benchDuration = execTime - p.lastSubOutGameTime;
                if (benchDuration >= 30000) {
                    p.currentStintTime = 0;
                }
                p.onField = true;
            }
            p.position = target;
        }
    });

    state.subPlan = null;
    state.planExpanded = false;
    saveState();
    render();
}

function clearSubPlan() {
    state.subPlan = null;
    saveState();
    render();
}

function togglePlanExpanded() {
    state.planExpanded = !state.planExpanded;
    if (state.planExpanded && !state.subPlan) {
        generateDefaultSubPlan();
    } else {
        saveState();
        render();
    }
}

function movePlayerInPlan(playerId, newPos) {
    if (!state.subPlan) {
        state.subPlan = {};
        state.roster.forEach(p => {
            if (p.isPresent) {
                state.subPlan[p.id] = p.onField ? (p.position || 'Unassigned') : 'Bench';
            }
        });
    }
    state.subPlan[playerId] = newPos;
    saveState();
    render();
}

function renderPlan() {
    if (!planSectionEl) return;

    if (state.planExpanded) {
        planContentEl.classList.remove('hidden');
        planToggleIcon.classList.add('expanded');
    } else {
        planContentEl.classList.add('hidden');
        planToggleIcon.classList.remove('expanded');
    }

    const changes = getPlannedChanges();
    if (changes.length > 0) {
        planBadgeEl.textContent = `${changes.length} ${changes.length === 1 ? 'move' : 'moves'}`;
        planBadgeEl.classList.remove('hidden');
    } else {
        planBadgeEl.classList.add('hidden');
    }

    if (!state.planExpanded) {
        const defsEl = planArrowsSvg.querySelector('defs');
        planArrowsSvg.innerHTML = defsEl ? defsEl.outerHTML : '';
        return;
    }

    const posActive = arePositionsActive();
    let rows = [];
    if (posActive) {
        rows = [
            { id: 'Goalie', label: 'Goalie', class: 'pos-g' },
            { id: 'Defense', label: 'Defense', class: 'pos-d' },
            { id: 'Midfield', label: 'Midfield', class: 'pos-m' },
            { id: 'Offense', label: 'Offense', class: 'pos-o' }
        ];
        if (state.roster.some(p => p.onField && p.isPresent && p.position === 'Unassigned')) {
            rows.push({ id: 'Unassigned', label: 'Unassigned', class: 'pos-u' });
        }
        rows.push({ id: 'Bench', label: 'Bench', class: 'plan-pos-tag-bench' });
    } else {
        rows = [
            { id: 'Unassigned', label: 'On Field', class: 'plan-pos-tag-field' },
            { id: 'Bench', label: 'Bench', class: 'plan-pos-tag-bench' }
        ];
    }

    planGridEl.innerHTML = '';
    rows.forEach(row => {
        const currentPlayers = state.roster.filter(p => {
            if (!p.isPresent) return false;
            const current = p.onField ? (p.position || 'Unassigned') : 'Bench';
            return current === row.id;
        });

        const plannedPlayers = state.roster.filter(p => {
            if (!p.isPresent) return false;
            const current = p.onField ? (p.position || 'Unassigned') : 'Bench';
            const planned = (state.subPlan && state.subPlan[p.id] !== undefined) ? state.subPlan[p.id] : current;
            return planned === row.id;
        });

        const leftChipsHtml = currentPlayers.map(p =>
            `<div class="plan-chip plan-chip-left" data-player-id="${p.id}">${p.name}</div>`
        ).join('');

        const rightChipsHtml = plannedPlayers.map(p =>
            `<div class="plan-chip plan-chip-right" draggable="true" data-player-id="${p.id}">${p.name}</div>`
        ).join('');

        const rowDiv = document.createElement('div');
        rowDiv.className = 'plan-pos-row';
        rowDiv.innerHTML = `
            <div class="plan-cell plan-cell-left">
                <div class="plan-cell-header">
                    <span class="plan-pos-tag ${row.class}">${row.label}</span>
                </div>
                <div class="plan-chips-container">
                    ${leftChipsHtml}
                </div>
            </div>
            <div class="plan-row-spacer"></div>
            <div class="plan-cell plan-cell-right plan-drop-zone" data-pos="${row.id}">
                <div class="plan-cell-header">
                    <span class="plan-pos-tag ${row.class}">${row.label}</span>
                </div>
                <div class="plan-chips-container">
                    ${rightChipsHtml}
                </div>
            </div>
        `;
        planGridEl.appendChild(rowDiv);
    });

    setupPlanDragAndDrop();
    requestAnimationFrame(drawPlanArrows);
}

function drawPlanArrows() {
    if (!state.planExpanded || !planArrowsSvg || !planGridEl) return;

    const svgRect = planArrowsSvg.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) return;

    const changes = getPlannedChanges();
    const posColors = {
        'Goalie': '#f39c12',
        'Defense': '#2980b9',
        'Midfield': '#27ae60',
        'Offense': '#c0392b',
        'Bench': '#e74c3c',
        'Unassigned': '#2ecc71'
    };

    let pathsHtml = '';

    changes.forEach(p => {
        const leftEl = planGridEl.querySelector(`.plan-chip-left[data-player-id="${p.id}"]`);
        const rightEl = planGridEl.querySelector(`.plan-chip-right[data-player-id="${p.id}"]`);
        if (!leftEl || !rightEl) return;

        const rLeft = leftEl.getBoundingClientRect();
        const rRight = rightEl.getBoundingClientRect();

        const x1 = rLeft.right - svgRect.left;
        const y1 = rLeft.top + rLeft.height / 2 - svgRect.top;
        const x2 = rRight.left - svgRect.left;
        const y2 = rRight.top + rRight.height / 2 - svgRect.top;

        const dx = Math.max(25, (x2 - x1) * 0.45);
        const cp1x = x1 + dx;
        const cp1y = y1;
        const cp2x = x2 - dx;
        const cp2y = y2;

        const targetPos = state.subPlan[p.id] || 'Defense';
        const color = posColors[targetPos] || '#3498db';
        const markerId = targetPos.toLowerCase();

        pathsHtml += `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" class="plan-arrow-path" stroke="${color}" marker-end="url(#arrow-${markerId})"/>`;
    });

    const defsEl = planArrowsSvg.querySelector('defs');
    const defsHtml = defsEl ? defsEl.outerHTML : '';
    planArrowsSvg.innerHTML = defsHtml + pathsHtml;
}

let activeDragPlayerId = null;
let touchDragClone = null;

function setupPlanDragAndDrop() {
    const chips = planGridEl.querySelectorAll('.plan-chip-right');
    chips.forEach(chip => {
        chip.addEventListener('dragstart', (e) => {
            const playerId = chip.dataset.playerId;
            activeDragPlayerId = playerId;
            e.dataTransfer.setData('text/plain', playerId);
            e.dataTransfer.effectAllowed = 'move';
            chip.classList.add('dragging');
        });

        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            activeDragPlayerId = null;
            planGridEl.querySelectorAll('.plan-drop-zone').forEach(z => z.classList.remove('drag-over'));
        });

        chip.addEventListener('touchstart', handleTouchStart, { passive: false });
    });

    const dropZones = planGridEl.querySelectorAll('.plan-drop-zone');
    dropZones.forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const playerId = e.dataTransfer.getData('text/plain') || activeDragPlayerId;
            const targetPos = zone.dataset.pos;
            if (playerId && targetPos) {
                movePlayerInPlan(playerId, targetPos);
            }
        });
    });
}

function handleTouchStart(e) {
    const chip = e.currentTarget;
    const playerId = chip.dataset.playerId;
    const touch = e.touches[0];
    activeDragPlayerId = playerId;

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
            touchDragClone = chip.cloneNode(true);
            touchDragClone.style.position = 'fixed';
            touchDragClone.style.pointerEvents = 'none';
            touchDragClone.style.zIndex = '1000';
            touchDragClone.style.opacity = '0.85';
            touchDragClone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
            document.body.appendChild(touchDragClone);
        }

        if (isDragging) {
            moveEvent.preventDefault();
            touchDragClone.style.left = `${moveTouch.clientX - touchDragClone.offsetWidth / 2}px`;
            touchDragClone.style.top = `${moveTouch.clientY - touchDragClone.offsetHeight / 2}px`;

            const elemUnder = document.elementFromPoint(moveTouch.clientX, moveTouch.clientY);
            const zone = elemUnder ? elemUnder.closest('.plan-drop-zone') : null;
            planGridEl.querySelectorAll('.plan-drop-zone').forEach(z => {
                if (z === zone) z.classList.add('drag-over');
                else z.classList.remove('drag-over');
            });
        }
    }

    function onTouchEnd(endEvent) {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        document.removeEventListener('touchcancel', onTouchEnd);

        if (touchDragClone) {
            touchDragClone.remove();
            touchDragClone = null;
        }
        chip.classList.remove('dragging');

        if (isDragging) {
            const endTouch = endEvent.changedTouches[0];
            const elemUnder = document.elementFromPoint(endTouch.clientX, endTouch.clientY);
            const zone = elemUnder ? elemUnder.closest('.plan-drop-zone') : null;
            planGridEl.querySelectorAll('.plan-drop-zone').forEach(z => z.classList.remove('drag-over'));
            if (zone && activeDragPlayerId) {
                movePlayerInPlan(activeDragPlayerId, zone.dataset.pos);
            }
        }
        activeDragPlayerId = null;
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
}

function toggleClock() {
    if (state.gameRunning) {
        syncState();
        state.gameRunning = false;
        state.lastSyncTimestamp = null;
    } else {
        state.gameRunning = true;
        state.lastSyncTimestamp = Date.now();
    }
    saveState();
    render();
}

function rewind() {
    syncState();
    const rewindMs = 30000;
    state.accumulatedGameTime = Math.max(0, state.accumulatedGameTime - rewindMs);
    state.roster.forEach(p => {
        if (p.onField) {
            if (p.position === 'Goalie') {
                p.goaliePlayTime = Math.max(0, (p.goaliePlayTime || 0) - rewindMs);
            } else {
                p.totalPlayTime = Math.max(0, p.totalPlayTime - rewindMs);
            }
            p.currentStintTime = Math.max(0, p.currentStintTime - rewindMs);
        } else {
            if (p.lastSubOutGameTime > state.accumulatedGameTime) {
                p.lastSubOutGameTime = state.accumulatedGameTime;
            }
        }
    });
    saveState();
    render();
}

function fastForward() {
    syncState();
    const forwardMs = 30000;
    state.accumulatedGameTime += forwardMs;
    state.roster.forEach(p => {
        if (p.onField) {
            if (p.position === 'Goalie') {
                p.goaliePlayTime = (p.goaliePlayTime || 0) + forwardMs;
            } else {
                p.totalPlayTime += forwardMs;
            }
            p.currentStintTime += forwardMs;
        }
    });
    saveState();
    render();
}

function addPlayer() {
    const name = playerNameInput.value.trim();
    if (name) {
        state.roster.push({
            id: Date.now().toString(),
            name: name,
            onField: false,
            totalPlayTime: 0,
            goaliePlayTime: 0,
            currentStintTime: 0,
            lastSubOutGameTime: state.accumulatedGameTime,
            isPresent: true,
            position: 'Unassigned'
        });
        playerNameInput.value = '';
        saveState();
        render();
    }
}

function removePlayer(id) {
    if (confirm('Remove player from roster?')) {
        state.roster = state.roster.filter(p => p.id !== id);
        if (state.subPlan && state.subPlan[id]) {
            delete state.subPlan[id];
        }
        saveState();
        render();
    }
}

function togglePresence(id) {
    const player = state.roster.find(p => p.id === id);
    if (player) {
        player.isPresent = !player.isPresent;
        if (state.subPlan && state.subPlan[id]) {
            delete state.subPlan[id];
        }
        if (!player.isPresent) {
            player.onField = false; // Player can't be on field if absent
        } else {
            if (state.accumulatedGameTime > 0) {
                player.lastSubOutGameTime = state.accumulatedGameTime;
            }
        }
    }
    saveState();
    render();
}

function subPlayer(id) {
    syncState();
    const player = state.roster.find(p => p.id === id);
    if (player && player.isPresent) {
        const nextOnField = !player.onField;
        if (nextOnField) {
            // Subbing in: reset stint time and position if enough time passed on bench
            const benchDuration = state.accumulatedGameTime - player.lastSubOutGameTime;
            if (benchDuration >= 30000) {
                player.currentStintTime = 0;
                player.position = 'Unassigned';
            }
        } else {
            // Subbing out: record game time
            player.lastSubOutGameTime = state.accumulatedGameTime;
        }
        player.onField = nextOnField;
    }
    saveState();
    render();
}

function resetGame() {
    if (confirm('Reset game clock and all player times? (Roster will be kept)')) {
        state.gameRunning = false;
        state.accumulatedGameTime = 0;
        state.lastSyncTimestamp = null;
        state.subPlan = null;
        state.planExpanded = false;
        state.roster.forEach(p => {
            p.totalPlayTime = 0;
            p.goaliePlayTime = 0;
            p.currentStintTime = 0;
            p.lastSubOutGameTime = 0;
            p.onField = false;
            p.position = 'Unassigned';
        });
        saveState();
        render();
    }
}

function getSortedOnField(stintTimes) {
    return state.roster.filter(p => p.onField && p.isPresent)
        .sort((a, b) => {
            const posA = POSITIONS.indexOf(a.position || 'Unassigned');
            const posB = POSITIONS.indexOf(b.position || 'Unassigned');
            if (posA !== posB) return posA - posB;
            return stintTimes[b.id] - stintTimes[a.id];
        });
}

function getSortedBench(playerTimes, benchTimes) {
    return state.roster.filter(p => !p.onField && p.isPresent)
        .sort((a, b) => {
            const benchA = (benchTimes && benchTimes[a.id]) || 0;
            const benchB = (benchTimes && benchTimes[b.id]) || 0;
            const benchDiff = benchB - benchA;
            if (benchDiff !== 0) return benchDiff;

            const playA = (playerTimes && playerTimes[a.id]) || 0;
            const playB = (playerTimes && playerTimes[b.id]) || 0;
            const playDiff = playA - playB;
            if (playDiff !== 0) return playDiff;

            return a.name.localeCompare(b.name);
        });
}

// Rendering
function render() {
    const { gameTime, playerTimes, stintTimes, benchTimes, goalieTimes } = getLiveTimes();
    
    // Update Clock
    stopwatchEl.textContent = formatTime(gameTime);
    toggleBtn.textContent = state.gameRunning ? 'Pause' : 'Start';
    toggleBtn.className = state.gameRunning ? 'btn-secondary' : 'btn-primary';

    // Calculate Shortest Stint
    const onFieldTotal = state.roster.filter(p => p.onField && p.isPresent);
    if (onFieldTotal.length > 0) {
        const minStint = Math.min(...onFieldTotal.map(p => stintTimes[p.id]));
        shortestStintEl.textContent = formatTime(minStint);
    } else {
        shortestStintEl.textContent = '--:--';
    }

    // Sort Players
    const onField = getSortedOnField(stintTimes);
    const bench = getSortedBench(playerTimes, benchTimes);

    // Update Headers visibility and structure
    if (onField.length > 0) {
        onFieldHeaderEl.classList.remove('hidden');
        onFieldHeaderEl.classList.add('has-stint'); // Matches on-field-card layout
    } else {
        onFieldHeaderEl.classList.add('hidden');
    }

    if (bench.length > 0) {
        benchHeaderEl.classList.remove('hidden');
    } else {
        benchHeaderEl.classList.add('hidden');
    }

    // Render Lists
    renderPlayerList(onFieldListEl, onField, playerTimes, stintTimes, 'on-field-card', goalieTimes);
    renderPlayerList(benchListEl, bench, playerTimes, benchTimes, 'bench-card', goalieTimes);
    
    // Render Substitution Plan
    renderPlan();

    // Admin Roster
    rosterListEl.innerHTML = '';
    state.roster.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${p.name}</span>
            <div class="roster-actions">
                <input type="checkbox" class="presence-checkbox" data-id="${p.id}" ${p.isPresent ? 'checked' : ''}>
                <button class="remove-player-btn" data-id="${p.id}">✕</button>
            </div>
        `;
        rosterListEl.appendChild(li);
    });

    // Toggle Admin visibility
    if (state.roster.length === 0) {
        adminContent.classList.remove('hidden');
        adminToggle.classList.add('hidden');
    } else {
        adminToggle.classList.remove('hidden');
    }
}

function renderPlayerList(container, players, times, secondaryTimes, cardClass, goalieTimes) {
    const POS_MAP = {
        'Unassigned': { short: '-', class: 'pos-u' },
        'Goalie': { short: 'G', class: 'pos-g' },
        'Defense': { short: 'D', class: 'pos-d' },
        'Midfield': { short: 'M', class: 'pos-m' },
        'Offense': { short: 'O', class: 'pos-o' }
    };

    container.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-card ${cardClass}`;
        
        if (p.needsFlash) {
            div.classList.add('flash-update');
            delete p.needsFlash;
        }

        const isRunning = state.gameRunning && p.onField;
        
        const goalieMins = goalieTimes ? Math.round((goalieTimes[p.id] || 0) / 60000) : 0;
        const goalieHtml = goalieMins > 0 ? `<span class="goalie-pill" title="Goalie Time: ${formatTime(goalieTimes[p.id])}">G ${goalieMins}m</span>` : '';

        // Planned change badge (only if planned position differs from current)
        let plannedBadgeHtml = '';
        if (state.subPlan) {
            const currentPos = p.onField ? (p.position || 'Unassigned') : 'Bench';
            const plannedPos = state.subPlan[p.id] !== undefined ? state.subPlan[p.id] : currentPos;
            if (plannedPos !== currentPos) {
                if (plannedPos === 'Bench') {
                    plannedBadgeHtml = `<span class="planned-change-badge queue-badge-out" title="Planned: Bench">➔ 🪑</span>`;
                } else {
                    const targetPosData = POS_MAP[plannedPos] || POS_MAP['Unassigned'];
                    plannedBadgeHtml = `<span class="planned-change-badge ${targetPosData.class}" title="Planned: ${plannedPos}">➔ ${targetPosData.short}</span>`;
                }
            }
        }

        let secondaryHtml = '';
        let posHtml = '';
        if (p.onField) {
            const posData = POS_MAP[p.position || 'Unassigned'] || POS_MAP['Unassigned'];
            posHtml = `<div class="pos-btn ${posData.class}" data-id="${p.id}">${posData.short}</div>`;
            if (secondaryTimes) {
                secondaryHtml = `<span class="player-time stint-time" title="Current Stint">${formatTime(secondaryTimes[p.id])}</span>`;
            }
            div.classList.add('has-stint');
        } else {
            if (secondaryTimes) {
                secondaryHtml = `<span class="player-time bench-time" title="Time on Bench">${formatTime(secondaryTimes[p.id])}</span>`;
            }
        }

        div.innerHTML = `
            <span class="player-name"><span class="player-name-text">${p.name}</span>${goalieHtml}${plannedBadgeHtml}</span>
            ${posHtml}
            <span class="player-time ${isRunning ? 'pulsing' : ''}" title="Total Time">${formatTime(times[p.id])}</span>
            ${secondaryHtml}
            <button class="sub-btn ${p.onField ? 'btn-secondary' : 'btn-primary'}" data-id="${p.id}">${p.onField ? 'Sub Out' : 'Sub In'}</button>
        `;
        container.appendChild(div);
    });
}

// Position Management Logic
const positionDialog = document.getElementById('position-dialog');
const positionOptions = document.getElementById('position-options');
const closeDialog = document.getElementById('close-dialog');
let longPressTimer = null;
let currentPosPlayerId = null;
let isLongPress = false;

function cyclePosition(id) {
    syncState();
    const player = state.roster.find(p => p.id === id);
    if (player) {
        performActionAndFlashIfMoved(() => {
            const currentIndex = POSITIONS.indexOf(player.position || 'Unassigned');
            const nextIndex = (currentIndex + 1) % POSITIONS.length;
            player.position = POSITIONS[nextIndex];
        });
        saveState();
        render();
    }
}

function openPositionDialog(id) {
    currentPosPlayerId = id;
    const player = state.roster.find(p => p.id === id);
    positionOptions.innerHTML = '';
    POSITIONS.forEach(pos => {
        const btn = document.createElement('button');
        // Bold the first character (or "---" for unassigned)
        if (pos === 'Unassigned') {
            btn.innerHTML = `<strong>-</strong> Unassigned`;
        } else {
            btn.innerHTML = `<strong>${pos.charAt(0)}</strong> ${pos.slice(1)}`;
        }
        
        if (player.position === pos) btn.style.borderColor = 'var(--primary)';
        btn.onclick = () => {
            syncState();
            performActionAndFlashIfMoved(() => {
                player.position = pos;
            });
            saveState();
            render();
            positionDialog.close();
        };
        positionOptions.appendChild(btn);
    });
    positionDialog.showModal();
}

closeDialog.onclick = () => positionDialog.close();

// Event Listeners for Pointer (Unified Touch/Mouse)
document.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('pos-btn')) {
        isLongPress = false;
        const id = e.target.dataset.id;
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            openPositionDialog(id);
        }, 1000);
    }
});

function cancelLongPress() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

document.addEventListener('pointerup', cancelLongPress);
document.addEventListener('pointercancel', cancelLongPress);
// Also cancel if the finger moves off the element significantly, though pointercancel often catches this
document.addEventListener('pointerout', cancelLongPress);

// Event Listeners
toggleBtn.addEventListener('click', toggleClock);
rewindBtn.addEventListener('click', rewind);
fastForwardBtn.addEventListener('click', fastForward);
addBtn.addEventListener('click', addPlayer);
resetBtn.addEventListener('click', resetGame);
adminToggle.addEventListener('click', () => adminContent.classList.toggle('hidden'));

if (planHeaderEl) planHeaderEl.addEventListener('click', togglePlanExpanded);
if (planExecuteBtn) planExecuteBtn.addEventListener('click', executeSubPlan);
if (planResetBtn) planResetBtn.addEventListener('click', generateDefaultSubPlan);
if (planClearBtn) planClearBtn.addEventListener('click', clearSubPlan);

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('pos-btn')) {
        // Ignore the click if it was the result of a long press
        if (isLongPress) return;
        cyclePosition(e.target.dataset.id);
    }
    if (e.target.classList.contains('sub-btn')) {
        subPlayer(e.target.dataset.id);
    }
    if (e.target.classList.contains('remove-player-btn')) {
        removePlayer(e.target.dataset.id);
    }
    if (e.target.classList.contains('presence-checkbox')) {
        togglePresence(e.target.dataset.id);
    }
});

window.addEventListener('resize', () => {
    if (state.planExpanded) drawPlanArrows();
});
window.addEventListener('scroll', () => {
    if (state.planExpanded) drawPlanArrows();
}, { passive: true });

// Init
loadState();
render();
setInterval(render, 1000); // Update UI every second
