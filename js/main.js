// App entry point: wires state logic to the UI. Loaded as ES module from index.html.
import {
    loadState, saveState, resetTimes, syncState, getLiveTimes, toggleClock,
    togglePresence, subPlayer, adjustAllTimes, STEP_MS
} from './state.js';
import { createPlayer } from './state.js';
import {
    generateDefaultSubPlan, executeSubPlan, clearSubPlan, movePlayerInPlan,
    getSortedOnField, getPlannedChanges
} from './plan.js';
import {
    render, initPositionDialog, redrawArrows, initPlanResizeObserver,
    isDragInProgress, bindStateRef, setPlanMoveHandler
} from './ui.js';

let state = loadState();
bindStateRef(state);
setPlanMoveHandler(onMoveInPlan);

const els = {
    toggleBtn: document.getElementById('toggle-btn'),
    rewindBtn: document.getElementById('rewind-btn'),
    fastForwardBtn: document.getElementById('fast-forward-btn'),
    addBtn: document.getElementById('add-btn'),
    resetBtn: document.getElementById('reset-btn'),
    adminToggle: document.getElementById('admin-toggle'),
    adminContent: document.getElementById('admin-content'),
    playerNameInput: document.getElementById('player-name'),
    forcePositionsToggle: document.getElementById('force-positions-toggle'),
    planHeader: document.getElementById('plan-header'),
    planExecuteBtn: document.getElementById('plan-execute-btn'),
    planResetBtn: document.getElementById('plan-reset-btn'),
    planClearBtn: document.getElementById('plan-clear-btn')
};

// One-time sync of form controls that reflect persisted preferences.
els.forcePositionsToggle.checked = !!state.forcePositions;

function persist() {
    saveState(state);
}

function rerender() {
    render(state);
}

// --- Actions ---

function onToggleClock() {
    toggleClock(state);
    persist();
    rerender();
}

function onRewind() {
    syncState(state);
    adjustAllTimes(state, -STEP_MS);
    persist();
    rerender();
}

function onFastForward() {
    syncState(state);
    adjustAllTimes(state, STEP_MS);
    persist();
    rerender();
}

function onAddPlayer() {
    const name = els.playerNameInput.value.trim();
    if (!name) return;
    syncState(state);
    state.roster.push(createPlayer(name, state.accumulatedGameTime));
    els.playerNameInput.value = '';
    persist();
    rerender();
}

function onRemovePlayer(id) {
    if (!confirm('Remove player from roster?')) return;
    syncState(state);
    state.roster = state.roster.filter(p => p.id !== id);
    if (state.subPlan && state.subPlan[id] !== undefined) delete state.subPlan[id];
    persist();
    rerender();
}

function onSubPlayer(id) {
    subPlayer(state, id);
    if (state.subPlan && getPlannedChanges(state).length === 0) {
        clearSubPlan(state);
    }
    persist();
    rerender();
}

function onResetGame() {
    if (!confirm('Reset game clock and all player times? (Roster will be kept)')) return;
    resetTimes(state);
    persist();
    rerender();
}

// Flash players whose on-field ordering changed as a result of `action`.
// Times are derived fresh on both sides so the comparison reflects the state
// at each point, even if `action` syncs the clock or accrues time.
function withReorderFlash(action) {
    const before = getSortedOnField(state, getLiveTimes(state).stintTimes).map(p => p.id);

    action();

    const after = getSortedOnField(state, getLiveTimes(state).stintTimes).map(p => p.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        after.forEach((id, index) => {
            if (before[index] !== id) {
                const player = state.roster.find(r => r.id === id);
                if (player) player.needsFlash = true;
            }
        });
    }
}

function onSetPosition(id, pos) {
    const player = state.roster.find(p => p.id === id);
    if (!player) return;
    withReorderFlash(() => {
        player.position = pos;
    });
    persist();
    rerender();
}

function onTogglePlanExpanded() {
    state.planExpanded = !state.planExpanded;
    if (state.planExpanded && !state.subPlan) {
        generateDefaultSubPlan(state);
    }
    persist();
    rerender();
}

function onMoveInPlan(playerId, newPos) {
    movePlayerInPlan(state, playerId, newPos);
    persist();
    rerender();
}

// --- Event wiring ---

els.toggleBtn.addEventListener('click', onToggleClock);
els.rewindBtn.addEventListener('click', onRewind);
els.fastForwardBtn.addEventListener('click', onFastForward);
els.addBtn.addEventListener('click', onAddPlayer);
els.playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onAddPlayer();
});
els.resetBtn.addEventListener('click', onResetGame);
els.adminToggle.addEventListener('click', () => els.adminContent.classList.toggle('hidden'));
els.forcePositionsToggle.addEventListener('change', (e) => {
    state.forcePositions = e.target.checked;
    persist();
    rerender();
});

els.planHeader.addEventListener('click', onTogglePlanExpanded);
els.planExecuteBtn.addEventListener('click', () => {
    executeSubPlan(state);
    persist();
    rerender();
});
els.planResetBtn.addEventListener('click', () => {
    generateDefaultSubPlan(state);
    persist();
    rerender();
});
els.planClearBtn.addEventListener('click', () => {
    clearSubPlan(state);
    persist();
    rerender();
});

// Delegated clicks for dynamically rendered buttons.
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('sub-btn')) {
        onSubPlayer(e.target.dataset.id);
    } else if (e.target.classList.contains('remove-player-btn')) {
        onRemovePlayer(e.target.dataset.id);
    } else if (e.target.classList.contains('presence-checkbox')) {
        togglePresence(state, e.target.dataset.id);
        persist();
        rerender();
    }
});

initPositionDialog(onSetPosition);
initPlanResizeObserver(state);

window.addEventListener('resize', () => {
    if (state.planExpanded) redrawArrows(state);
});
window.addEventListener('scroll', () => {
    if (state.planExpanded) redrawArrows(state);
}, { passive: true });

// --- Init ---

rerender();
setInterval(() => {
    if (!state.gameRunning || isDragInProgress()) return;
    render(state, { updatePlanGrid: false });
}, 1000);
