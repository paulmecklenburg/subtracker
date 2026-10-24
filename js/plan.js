// Substitution plan logic. Pure state mutations; callers persist + render.
import { BENCH, POSITIONS, SINGLE_PLAYER_POSITIONS } from './positions.js';
import { getLiveTimes, syncState, BENCH_STINT_RESET_MS } from './state.js';

const LEFT_SIDE = ['Defense Left', 'Midfield Left', 'Offense Left'];
const RIGHT_SIDE = ['Defense Right', 'Midfield Right', 'Offense Right'];

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

// Assign a player to a position in the plan. If the target is a single-player
// on-field position, any present player currently planned for that slot is
// automatically unassigned to off-field (Bench).
export function movePlayerInPlan(state, playerId, newPos) {
    const plan = ensurePlan(state);
    if (SINGLE_PLAYER_POSITIONS.includes(newPos)) {
        state.roster.forEach(p => {
            if (p.isPresent && p.id !== playerId && getPlannedSlot(state, p) === newPos) {
                plan[p.id] = BENCH;
            }
        });
    }
    plan[playerId] = newPos;
    return state;
}

function getSideOutgoing(onField, [defPos, midPos, offPos]) {
    return onField.find(p => p.position === offPos)
        || onField.find(p => p.position === midPos)
        || onField.find(p => p.position === defPos)
        || null;
}

// Advance one side of the field: front-most occupied position goes to Bench,
// remaining players on that side move forward one line without changing sides,
// and the incoming bench player enters Defense on that side.
function advanceSide(plan, onField, [defPos, midPos, offPos], benchPlayer) {
    const defP = onField.find(p => p.position === defPos);
    const midP = onField.find(p => p.position === midPos);
    const offP = onField.find(p => p.position === offPos);

    if (offP) {
        plan[offP.id] = BENCH;
        if (midP) plan[midP.id] = offPos;
        if (defP) plan[defP.id] = midPos;
        plan[benchPlayer.id] = defPos;
    } else if (midP) {
        plan[midP.id] = BENCH;
        if (defP) plan[defP.id] = midPos;
        plan[benchPlayer.id] = defPos;
    } else if (defP) {
        plan[defP.id] = BENCH;
        plan[benchPlayer.id] = defPos;
    }
}

// Auto-rotate: keep players on the same side of the field, sub in new players
// at Defense Left/Right, and move existing field players forward one line.
export function generateDefaultSubPlan(state) {
    syncState(state);
    const { playerTimes, stintTimes, benchTimes } = getLiveTimes(state);
    const onField = state.roster.filter(p => p.onField && p.isPresent);
    const bench = getSortedBench(state, playerTimes, benchTimes);

    const plan = {};
    state.roster.forEach(p => {
        if (p.isPresent) plan[p.id] = getCurrentSlot(p);
    });

    if (state.disableAutoAdvance) {
        state.subPlan = plan;
        return state;
    }

    if (onField.length > 0 && bench.length > 0) {
        if (arePositionsActive(state)) {
            const activeSides = [];
            const leftOut = getSideOutgoing(onField, LEFT_SIDE);
            const rightOut = getSideOutgoing(onField, RIGHT_SIDE);
            if (leftOut) activeSides.push({ slots: LEFT_SIDE, outgoing: leftOut });
            if (rightOut) activeSides.push({ slots: RIGHT_SIDE, outgoing: rightOut });

            if (activeSides.length > 0) {
                activeSides.sort((a, b) => (stintTimes[b.outgoing.id] || 0) - (stintTimes[a.outgoing.id] || 0));
                const numSubs = Math.min(activeSides.length, bench.length);
                for (let i = 0; i < numSubs; i++) {
                    advanceSide(plan, onField, activeSides[i].slots, bench[i]);
                }
            } else {
                const eligibleOnField = onField
                    .filter(p => p.position !== 'Goalie')
                    .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));
                const numSubs = Math.min(eligibleOnField.length, bench.length);
                eligibleOnField.slice(0, numSubs).forEach(p => { plan[p.id] = BENCH; });
                bench.slice(0, numSubs).forEach(p => { plan[p.id] = 'Unassigned'; });
            }
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

// --- Plan row layout ---

// Which rows the substitution plan shows, ordered top-to-bottom to match the
// field: Offense (L/R), Midfield (L/R), Defense (L/R), Goalie, Unassigned (if
// any), and Bench at the very bottom.
export function getPlanRows(state) {
    if (arePositionsActive(state) || state.forcePositions) {
        const rows = [
            {
                id: 'Offense',
                label: 'Offense',
                class: 'pos-o',
                slots: [
                    { id: 'Offense Left', label: 'OL', class: 'pos-o' },
                    { id: 'Offense Right', label: 'OR', class: 'pos-o' }
                ]
            },
            {
                id: 'Midfield',
                label: 'Midfield',
                class: 'pos-m',
                slots: [
                    { id: 'Midfield Left', label: 'ML', class: 'pos-m' },
                    { id: 'Midfield Right', label: 'MR', class: 'pos-m' }
                ]
            },
            {
                id: 'Defense',
                label: 'Defense',
                class: 'pos-d',
                slots: [
                    { id: 'Defense Left', label: 'DL', class: 'pos-d' },
                    { id: 'Defense Right', label: 'DR', class: 'pos-d' }
                ]
            },
            {
                id: 'Goalie',
                label: 'Goalie',
                class: 'pos-g',
                slots: [
                    { id: 'Goalie', label: 'Goalie', class: 'pos-g' }
                ]
            }
        ];
        if (state.roster.some(p => p.isPresent && (getCurrentSlot(p) === 'Unassigned' || getPlannedSlot(state, p) === 'Unassigned'))) {
            rows.push({
                id: 'Unassigned',
                label: 'Unassigned',
                class: 'pos-u',
                slots: [{ id: 'Unassigned', label: 'Unassigned', class: 'pos-u' }]
            });
        }
        rows.push({
            id: BENCH,
            label: 'Bench',
            class: 'plan-pos-tag-bench',
            slots: [{ id: BENCH, label: 'Bench', class: 'plan-pos-tag-bench' }]
        });
        return rows;
    }
    return [
        {
            id: 'Unassigned',
            label: 'On Field',
            class: 'plan-pos-tag-field',
            slots: [{ id: 'Unassigned', label: 'On Field', class: 'plan-pos-tag-field' }]
        },
        {
            id: BENCH,
            label: 'Bench',
            class: 'plan-pos-tag-bench',
            slots: [{ id: BENCH, label: 'Bench', class: 'plan-pos-tag-bench' }]
        }
    ];
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
