// Substitution plan logic. Pure state mutations; callers persist + render.
import { BENCH, POSITIONS } from './positions.js';
import { getLiveTimes, syncState, BENCH_STINT_RESET_MS } from './state.js';

export function getCurrentSlot(p) {
    return p.onField ? (p.position || 'Unassigned') : BENCH;
}

export function getPlannedSlot(state, p) {
    return (state.subPlan && state.subPlan[p.id] !== undefined) ? state.subPlan[p.id] : getCurrentSlot(p);
}

export function arePositionsActive(state) {
    return state.roster.some(p => p.onField && p.isPresent && p.position && p.position !== 'Unassigned');
}

// Players whose planned slot differs from their current slot.
export function getPlannedChanges(state) {
    if (!state.subPlan) return [];
    return state.roster.filter(p => p.isPresent && getPlannedSlot(state, p) !== getCurrentSlot(p));
}

// Ensure a plan object exists covering all present players.
function ensurePlan(state) {
    if (!state.subPlan) {
        state.subPlan = {};
        state.roster.forEach(p => {
            if (p.isPresent) state.subPlan[p.id] = getCurrentSlot(p);
        });
    }
    return state.subPlan;
}

export function movePlayerInPlan(state, playerId, newPos) {
    ensurePlan(state)[playerId] = newPos;
    return state;
}

// Auto-rotate: tired players off, rested players on, field shifts up one line.
export function generateDefaultSubPlan(state) {
    syncState(state);
    const { playerTimes, stintTimes, benchTimes } = getLiveTimes(state);
    const onField = state.roster.filter(p => p.onField && p.isPresent);
    const bench = getSortedBench(state, playerTimes, benchTimes);

    const plan = {};
    state.roster.forEach(p => {
        if (p.isPresent) plan[p.id] = getCurrentSlot(p);
    });

    if (onField.length > 0 && bench.length > 0) {
        if (arePositionsActive(state)) {
            const offensePlayers = onField.filter(p => p.position === 'Offense')
                .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));
            const eligibleOnField = onField.filter(p => p.position !== 'Goalie')
                .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));

            const candidateOut = offensePlayers.length > 0 ? offensePlayers : eligibleOnField;
            const numSubs = Math.min(candidateOut.length, bench.length);
            const subsOut = candidateOut.slice(0, numSubs);
            const subsIn = bench.slice(0, numSubs);

            subsOut.forEach(p => { plan[p.id] = BENCH; });
            subsIn.forEach(p => { plan[p.id] = 'Defense'; });

            // Field shifts: Defense -> Midfield, Midfield -> Offense (Goalie and Unassigned remain).
            onField.forEach(p => {
                if (subsOut.some(s => s.id === p.id)) return;
                if (p.position === 'Goalie' || p.position === 'Unassigned') return;
                if (p.position === 'Defense') plan[p.id] = 'Midfield';
                else if (p.position === 'Midfield') plan[p.id] = 'Offense';
            });
        } else {
            // Positions not actively in use: rotate onField <-> Bench.
            const numSubs = Math.min(onField.length, bench.length);
            const subsOut = onField
                .slice()
                .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0))
                .slice(0, numSubs);
            const subsIn = bench.slice(0, numSubs);

            subsOut.forEach(p => { plan[p.id] = BENCH; });
            subsIn.forEach(p => { plan[p.id] = 'Unassigned'; });
        }
    }

    state.subPlan = plan;
    return state;
}

export function executeSubPlan(state, now = Date.now()) {
    if (!state.subPlan) return state;
    syncState(state, now);
    const execTime = state.accumulatedGameTime;

    state.roster.forEach(p => {
        if (!p.isPresent) return;
        const current = getCurrentSlot(p);
        const target = state.subPlan[p.id] !== undefined ? state.subPlan[p.id] : current;
        if (target === current) return;

        if (target === BENCH) {
            p.onField = false;
            p.lastSubOutGameTime = execTime;
        } else {
            if (!p.onField) {
                const benchDuration = execTime - p.lastSubOutGameTime;
                if (benchDuration >= BENCH_STINT_RESET_MS) {
                    p.currentStintTime = 0;
                }
                p.onField = true;
            }
            p.position = target;
        }
    });

    state.subPlan = null;
    state.planExpanded = false;
    return state;
}

export function clearSubPlan(state) {
    state.subPlan = null;
    return state;
}

// --- Sorting helpers ---

export function getSortedOnField(state, stintTimes) {
    return state.roster.filter(p => p.onField && p.isPresent)
        .slice()
        .sort((a, b) => {
            const posA = POSITIONS.indexOf(a.position || 'Unassigned');
            const posB = POSITIONS.indexOf(b.position || 'Unassigned');
            if (posA !== posB) return posA - posB;
            return stintTimes[b.id] - stintTimes[a.id];
        });
}

export function getSortedBench(state, playerTimes, benchTimes) {
    return state.roster.filter(p => !p.onField && p.isPresent)
        .slice()
        .sort((a, b) => {
            const benchDiff = ((benchTimes && benchTimes[b.id]) || 0) - ((benchTimes && benchTimes[a.id]) || 0);
            if (benchDiff !== 0) return benchDiff;
            const playDiff = ((playerTimes && playerTimes[a.id]) || 0) - ((playerTimes && playerTimes[b.id]) || 0);
            if (playDiff !== 0) return playDiff;
            return a.name.localeCompare(b.name);
        });
}
