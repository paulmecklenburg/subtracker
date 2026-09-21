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

// Plan a line's next stint: longest-stint players out to Bench, bench players
// in at Defense, then shift players up one line to backfill. All shifts move
// an equal number of players (limited by each line's capacity) so line counts
// stay balanced.
function subOutLine(plan, line, bench, shifters) {
    const numSubs = Math.min(line.length, bench.length);
    const subsOut = line.slice(0, numSubs);
    subsOut.forEach(p => { plan[p.id] = BENCH; });
    bench.slice(0, numSubs).forEach(p => { plan[p.id] = 'Defense'; });

    const notSubbedOut = players => players.filter(p => !subsOut.includes(p));
    const numShift = Math.min(numSubs, ...shifters.map(s => notSubbedOut(s.players).length));
    shifters.forEach(s => notSubbedOut(s.players).slice(0, numShift).forEach(p => { plan[p.id] = s.to; }));
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
            const byLongestStint = list =>
                list.sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));
            const offensePlayers = byLongestStint(onField.filter(p => p.position === 'Offense'));
            const midfieldPlayers = byLongestStint(onField.filter(p => p.position === 'Midfield'));
            const defensePlayers = byLongestStint(onField.filter(p => p.position === 'Defense'));

            // Sub out the forward-most line that has players.
            const subbedLine = offensePlayers.length > 0 ? offensePlayers
                : midfieldPlayers.length > 0 ? midfieldPlayers
                : defensePlayers.length > 0 ? defensePlayers
                : null;

            if (subbedLine) {
                // Backfill the subbed line from the line below it; when the
                // subbed line is Offense, Midfield is backfilled from Defense
                // in the same proportion.
                const shifters = subbedLine === offensePlayers
                    ? [{ players: defensePlayers, to: 'Midfield' }, { players: midfieldPlayers, to: 'Offense' }]
                    : subbedLine === midfieldPlayers
                        ? [{ players: defensePlayers, to: 'Midfield' }]
                        : [];
                subOutLine(plan, subbedLine, bench, shifters);
            } else {
                const eligibleOnField = byLongestStint(onField.filter(p => p.position !== 'Goalie'));
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

// Which rows the substitution plan shows. When no positions are in use the
// plan collapses to On Field/Bench, unless forcePositions asks for the full
// Goalie/Defense/Midfield/Offense layout (e.g. during initial game setup).
export function getPlanRows(state) {
    if (arePositionsActive(state) || state.forcePositions) {
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
