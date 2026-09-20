// Pure state + time logic. No DOM access at import time (importable from Node tests).
import { POSITIONS, newId } from './positions.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function createInitialState() {
    return {
        gameRunning: false,
        accumulatedGameTime: 0,
        lastSyncTimestamp: null,
        lastUpdate: Date.now(),
        roster: [],
        subPlan: null,
        planExpanded: false
    };
}

export function createPlayer(name, gameTime = 0) {
    return {
        id: newId(),
        name,
        onField: false,
        totalPlayTime: 0,
        goaliePlayTime: 0,
        currentStintTime: 0,
        lastSubOutGameTime: gameTime,
        isPresent: true,
        position: 'Unassigned'
    };
}

// --- Persistence ---

export function loadState(storage = localStorage, now = Date.now()) {
    let state = createInitialState();
    let saved = null;
    try {
        saved = storage.getItem('subtracker_state');
    } catch {
        return state;
    }
    if (!saved) return state;

    let parsed;
    try {
        parsed = JSON.parse(saved);
    } catch {
        return state; // Corrupted save: start fresh rather than crash.
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.roster)) return state;

    // Auto-reset if more than 24 hours have passed.
    if (now - (parsed.lastUpdate || 0) > DAY_MS) {
        parsed = resetTimes(parsed);
    }

    state = parsed;
    if (state.subPlan !== null && (typeof state.subPlan !== 'object' || Array.isArray(state.subPlan))) {
        state.subPlan = null;
    }
    if (state.planExpanded === undefined) state.planExpanded = false;

    // Migration: ensure all players have needed properties.
    state.roster.forEach(p => {
        if (p.onField === undefined) p.onField = false;
        if (p.totalPlayTime === undefined) p.totalPlayTime = 0;
        if (p.isPresent === undefined) p.isPresent = true;
        if (p.currentStintTime === undefined) p.currentStintTime = 0;
        if (p.lastSubOutGameTime === undefined) p.lastSubOutGameTime = 0;
        if (p.goaliePlayTime === undefined) p.goaliePlayTime = 0;
        if (p.position === undefined) p.position = 'Unassigned';
        if (p.id === undefined) p.id = newId();
        if (p.name === undefined) p.name = '?';
    });
    return state;
}

export function saveState(state, storage = localStorage, now = Date.now()) {
    try {
        state.lastUpdate = now;
        storage.setItem('subtracker_state', JSON.stringify(state));
    } catch {
        // Storage unavailable (private mode etc.): app still works in-memory.
    }
}

export function resetTimes(state) {
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
    return state;
}

// --- Time calculation ---

const clamp0 = n => Math.max(0, n);

// Live times between syncs. delta is only nonzero while the clock runs.
export function getLiveTimes(state, now = Date.now()) {
    const delta = (state.gameRunning && state.lastSyncTimestamp) ? (now - state.lastSyncTimestamp) : 0;
    const gameTime = clamp0(state.accumulatedGameTime + delta);

    const playerTimes = {};
    const goalieTimes = {};
    const stintTimes = {};
    const benchTimes = {};
    state.roster.forEach(p => {
        const outfield = state.gameRunning && p.onField && p.position !== 'Goalie';
        const goalie = state.gameRunning && p.onField && p.position === 'Goalie';
        const onField = state.gameRunning && p.onField;
        playerTimes[p.id] = clamp0(p.totalPlayTime + (outfield ? delta : 0));
        goalieTimes[p.id] = clamp0((p.goaliePlayTime || 0) + (goalie ? delta : 0));
        stintTimes[p.id] = clamp0(p.currentStintTime + (onField ? delta : 0));
        benchTimes[p.id] = (!p.onField && p.isPresent) ? clamp0(gameTime - (p.lastSubOutGameTime || 0)) : 0;
    });

    return { gameTime, delta, playerTimes, goalieTimes, stintTimes, benchTimes };
}

// Fold live delta into stored totals. Called before any mutation of time fields.
export function syncState(state, now = Date.now()) {
    if (!state.gameRunning || !state.lastSyncTimestamp) return state;
    const delta = now - state.lastSyncTimestamp;
    state.accumulatedGameTime += delta;
    state.roster.forEach(p => {
        if (!p.onField) return;
        if (p.position === 'Goalie') {
            p.goaliePlayTime = (p.goaliePlayTime || 0) + delta;
        } else {
            p.totalPlayTime += delta;
        }
        p.currentStintTime += delta;
    });
    state.lastSyncTimestamp = now;
    return state;
}

// Adjust all clocks by +/- delta (rewind / fast-forward).
export function adjustAllTimes(state, delta) {
    state.accumulatedGameTime = clamp0(state.accumulatedGameTime + delta);
    state.roster.forEach(p => {
        if (p.onField) {
            if (p.position === 'Goalie') {
                p.goaliePlayTime = clamp0((p.goaliePlayTime || 0) + delta);
            } else {
                p.totalPlayTime = clamp0(p.totalPlayTime + delta);
            }
            p.currentStintTime = clamp0(p.currentStintTime + delta);
        } else if (delta < 0 && p.lastSubOutGameTime > state.accumulatedGameTime) {
            p.lastSubOutGameTime = state.accumulatedGameTime;
        }
    });
    return state;
}

// --- Roster actions (pure state mutations; callers persist + render) ---

export function toggleClock(state, now = Date.now()) {
    if (state.gameRunning) {
        syncState(state, now);
        state.gameRunning = false;
        state.lastSyncTimestamp = null;
    } else {
        state.gameRunning = true;
        state.lastSyncTimestamp = now;
    }
    return state;
}

export function togglePresence(state, id, now = Date.now()) {
    const player = state.roster.find(p => p.id === id);
    if (!player) return state;
    syncState(state, now); // Fold pending delta first so no time is lost.
    player.isPresent = !player.isPresent;
    if (state.subPlan && state.subPlan[id] !== undefined) delete state.subPlan[id];
    if (!player.isPresent) {
        player.onField = false;
    } else if (state.accumulatedGameTime > 0) {
        player.lastSubOutGameTime = state.accumulatedGameTime;
    }
    return state;
}

export function subPlayer(state, id, now = Date.now(), benchResetMs = BENCH_STINT_RESET_MS) {
    const player = state.roster.find(p => p.id === id);
    if (!player || !player.isPresent) return state;
    syncState(state, now);
    const nextOnField = !player.onField;
    if (nextOnField) {
        // Subbing in: reset stint (and position) if enough bench time elapsed.
        const benchDuration = state.accumulatedGameTime - player.lastSubOutGameTime;
        if (benchDuration >= benchResetMs) {
            player.currentStintTime = 0;
            player.position = 'Unassigned';
        }
    } else {
        player.lastSubOutGameTime = state.accumulatedGameTime;
    }
    player.onField = nextOnField;
    return state;
}

export const BENCH_STINT_RESET_MS = 30000;
export const STEP_MS = 30000;
