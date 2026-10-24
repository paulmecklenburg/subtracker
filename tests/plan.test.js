import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createPlayer, syncState } from '../js/state.js';
import {
    getCurrentSlot, getPlannedSlot, getPlannedChanges, arePositionsActive,
    generateDefaultSubPlan, executeSubPlan, clearSubPlan, movePlayerInPlan,
    getSortedOnField, getSortedBench, getPlanRows
} from '../js/plan.js';
import { BENCH } from '../js/positions.js';

function makePlayer(name, overrides = {}) {
    return { ...createPlayer(name, 0), ...overrides };
}

function setup(players) {
    const state = createInitialState();
    state.roster = players.map(([name, overrides]) => makePlayer(name, overrides));
    return state;
}

test('getCurrentSlot: on-field returns position, off-field returns Bench', () => {
    const a = makePlayer('A', { onField: true, position: 'Defense Left' });
    const b = makePlayer('B', { onField: false });
    assert.equal(getCurrentSlot(a), 'Defense Left');
    assert.equal(getCurrentSlot(b), BENCH);
});

test('getPlannedSlot falls back to current slot when no plan entry', () => {
    const state = setup([['A', { onField: true, position: 'Defense Left' }]]);
    state.subPlan = {};
    assert.equal(getPlannedSlot(state, state.roster[0]), 'Defense Left');
});

test('getPlannedChanges lists only players whose slot changes', () => {
    const state = setup([
        ['A', { onField: true, position: 'Offense Left' }],
        ['B', { onField: false }],
        ['C', { onField: true, position: 'Defense Left' }]
    ]);
    state.subPlan = {
        [state.roster[0].id]: BENCH,           // change
        [state.roster[1].id]: 'Defense Left',  // change
        [state.roster[2].id]: 'Defense Left'   // same
    };
    const changes = getPlannedChanges(state);
    assert.deepEqual(changes.map(p => p.name), ['A', 'B']);
});

test('getPlannedChanges ignores absent players', () => {
    const state = setup([['A', { isPresent: false }]]);
    state.subPlan = { [state.roster[0].id]: 'Goalie' };
    assert.equal(getPlannedChanges(state).length, 0);
});

test('arePositionsActive: true only when an on-field present player has a real position', () => {
    assert.equal(arePositionsActive(setup([['A', { onField: true, position: 'Unassigned' }]])), false);
    assert.equal(arePositionsActive(setup([['A', { onField: false, position: 'Defense Left' }]])), false);
    assert.equal(arePositionsActive(setup([['A', { onField: true, position: 'Defense Left' }]])), true);
});

// --- Plan rows ---

test('getPlanRows collapses to On Field/Bench when no positions are active', () => {
    const state = setup([['A', { onField: true, position: 'Unassigned' }], ['B', { onField: false }]]);
    const ids = getPlanRows(state).map(r => r.id);
    assert.deepEqual(ids, ['Unassigned', BENCH]);
});

test('getPlanRows shows field layout (Offense -> Midfield -> Defense -> Goalie -> Bench) with L/R slots when positions are active', () => {
    const state = setup([
        ['A', { onField: true, position: 'Defense Left' }],
        ['B', { onField: false }]
    ]);
    const rows = getPlanRows(state);
    assert.deepEqual(rows.map(r => r.id), ['Offense', 'Midfield', 'Defense', 'Goalie', BENCH]);
    assert.deepEqual(rows[0].slots.map(s => s.id), ['Offense Left', 'Offense Right']);
    assert.deepEqual(rows[1].slots.map(s => s.id), ['Midfield Left', 'Midfield Right']);
    assert.deepEqual(rows[2].slots.map(s => s.id), ['Defense Left', 'Defense Right']);
    assert.deepEqual(rows[3].slots.map(s => s.id), ['Goalie']);
    assert.deepEqual(rows[4].slots.map(s => s.id), [BENCH]);
});

test('getPlanRows forcePositions shows full layout even with no positions assigned', () => {
    const state = setup([
        ['A', { onField: true, position: 'Unassigned' }],
        ['B', { onField: false }]
    ]);
    state.forcePositions = true;
    // On-field player is Unassigned, so that row is still included above Bench.
    const ids = getPlanRows(state).map(r => r.id);
    assert.deepEqual(ids, ['Offense', 'Midfield', 'Defense', 'Goalie', 'Unassigned', BENCH]);
});

test('getPlanRows forcePositions with everyone on bench: O/M/D/G plus Bench only', () => {
    const state = setup([['A', { onField: false }], ['B', { onField: false }]]);
    state.forcePositions = true;
    const ids = getPlanRows(state).map(r => r.id);
    assert.deepEqual(ids, ['Offense', 'Midfield', 'Defense', 'Goalie', BENCH]);
});

test('generateDefaultSubPlan without positions: swaps most-tired on-field with longest-benched', () => {
    const state = setup([
        ['Tired', { onField: true, currentStintTime: 60000 }],
        ['Fresh', { onField: true, currentStintTime: 5000 }],
        ['AlsoFresh', { onField: true, currentStintTime: 4000 }],
        ['Rested', { onField: false, lastSubOutGameTime: 60000 }],
        ['JustOut', { onField: false, lastSubOutGameTime: 59000 }]
    ]);
    state.accumulatedGameTime = 60000;
    generateDefaultSubPlan(state);
    const plan = state.subPlan;
    const byName = Object.fromEntries(state.roster.map(p => [p.name, plan[p.id]]));
    // numSubs = min(3 on-field, 2 bench) = 2: the two longest-stint players go out.
    assert.equal(byName['Tired'], BENCH);
    assert.equal(byName['Fresh'], BENCH);
    assert.equal(byName['AlsoFresh'], 'Unassigned'); // shortest stint stays on
    // Bench players come on in bench-time order.
    assert.equal(byName['JustOut'], 'Unassigned');
    assert.equal(byName['Rested'], 'Unassigned');
});

test('generateDefaultSubPlan with positions: keeps players on same side and subs two bench players into Defense Left/Right', () => {
    const state = setup([
        ['OL', { onField: true, position: 'Offense Left', currentStintTime: 50000 }],
        ['OR', { onField: true, position: 'Offense Right', currentStintTime: 40000 }],
        ['ML', { onField: true, position: 'Midfield Left', currentStintTime: 30000 }],
        ['MR', { onField: true, position: 'Midfield Right', currentStintTime: 25000 }],
        ['DL', { onField: true, position: 'Defense Left', currentStintTime: 20000 }],
        ['DR', { onField: true, position: 'Defense Right', currentStintTime: 15000 }],
        ['Goal', { onField: true, position: 'Goalie', currentStintTime: 60000 }],
        ['Bench1', { onField: false, lastSubOutGameTime: 0 }],
        ['Bench2', { onField: false, lastSubOutGameTime: 1000 }]
    ]);
    state.accumulatedGameTime = 50000;
    syncState(state, Date.now()); // no-op, clock not running
    generateDefaultSubPlan(state);
    const byName = Object.fromEntries(state.roster.map(p => [p.name, state.subPlan[p.id]]));
    // Offense Left & Right go to Bench.
    assert.equal(byName['OL'], BENCH);
    assert.equal(byName['OR'], BENCH);
    // Midfield Left & Right advance to Offense on their same side.
    assert.equal(byName['ML'], 'Offense Left');
    assert.equal(byName['MR'], 'Offense Right');
    // Defense Left & Right advance to Midfield on their same side.
    assert.equal(byName['DL'], 'Midfield Left');
    assert.equal(byName['DR'], 'Midfield Right');
    // Two bench players enter Defense Left and Defense Right.
    assert.equal(byName['Bench1'], 'Defense Left');
    assert.equal(byName['Bench2'], 'Defense Right');
    // Goalie untouched.
    assert.equal(byName['Goal'], 'Goalie');
});

test('generateDefaultSubPlan with positions: with 1 bench player, advances only the side with longer-stint outgoing player', () => {
    const state = setup([
        ['OL', { onField: true, position: 'Offense Left', currentStintTime: 30000 }],
        ['OR', { onField: true, position: 'Offense Right', currentStintTime: 50000 }],
        ['ML', { onField: true, position: 'Midfield Left', currentStintTime: 20000 }],
        ['MR', { onField: true, position: 'Midfield Right', currentStintTime: 25000 }],
        ['DL', { onField: true, position: 'Defense Left', currentStintTime: 10000 }],
        ['DR', { onField: true, position: 'Defense Right', currentStintTime: 15000 }],
        ['Goal', { onField: true, position: 'Goalie', currentStintTime: 10000 }],
        ['Bench1', { onField: false, lastSubOutGameTime: 0 }]
    ]);
    state.accumulatedGameTime = 50000;
    generateDefaultSubPlan(state);
    const byName = Object.fromEntries(state.roster.map(p => [p.name, state.subPlan[p.id]]));
    // Right side has the longer-stint outgoing player (OR: 50s vs OL: 30s), so Right side advances:
    assert.equal(byName['OR'], BENCH);
    assert.equal(byName['MR'], 'Offense Right');
    assert.equal(byName['DR'], 'Midfield Right');
    assert.equal(byName['Bench1'], 'Defense Right');
    // Left side stays put:
    assert.equal(byName['OL'], 'Offense Left');
    assert.equal(byName['ML'], 'Midfield Left');
    assert.equal(byName['DL'], 'Defense Left');
    assert.equal(byName['Goal'], 'Goalie');
});

test('generateDefaultSubPlan with positions: rotates forward lines on each side when offense is empty', () => {
    const state = setup([
        ['ML', { onField: true, position: 'Midfield Left', currentStintTime: 40000 }],
        ['MR', { onField: true, position: 'Midfield Right', currentStintTime: 30000 }],
        ['DL', { onField: true, position: 'Defense Left', currentStintTime: 20000 }],
        ['DR', { onField: true, position: 'Defense Right', currentStintTime: 10000 }],
        ['Bench1', { onField: false, lastSubOutGameTime: 0 }]
    ]);
    state.accumulatedGameTime = 40000;
    generateDefaultSubPlan(state);
    const byName = Object.fromEntries(state.roster.map(p => [p.name, state.subPlan[p.id]]));
    // ML (longest stint in forward-most occupied slot) goes to Bench
    assert.equal(byName['ML'], BENCH);
    assert.equal(byName['DL'], 'Midfield Left');
    assert.equal(byName['Bench1'], 'Defense Left');
    // Right side untouched
    assert.equal(byName['MR'], 'Midfield Right');
    assert.equal(byName['DR'], 'Defense Right');
});

test('generateDefaultSubPlan respects disableAutoAdvance setting', () => {
    const state = setup([
        ['OL', { onField: true, position: 'Offense Left', currentStintTime: 50000 }],
        ['DL', { onField: true, position: 'Defense Left', currentStintTime: 20000 }],
        ['Bench1', { onField: false, lastSubOutGameTime: 0 }]
    ]);
    state.disableAutoAdvance = true;
    generateDefaultSubPlan(state);
    assert.equal(getPlannedChanges(state).length, 0);
    assert.equal(state.subPlan[state.roster[0].id], 'Offense Left');
    assert.equal(state.subPlan[state.roster[1].id], 'Defense Left');
    assert.equal(state.subPlan[state.roster[2].id], BENCH);
});

test('movePlayerInPlan creates plan lazily covering all present players', () => {
    const state = setup([
        ['A', { onField: true, position: 'Defense Left' }],
        ['B', { onField: false }],
        ['Gone', { isPresent: false }]
    ]);
    movePlayerInPlan(state, state.roster[1].id, 'Goalie');
    assert.equal(state.subPlan[state.roster[1].id], 'Goalie');
    assert.equal(state.subPlan[state.roster[0].id], 'Defense Left'); // baseline entry created
    assert.equal(state.subPlan[state.roster[2].id], undefined); // absent excluded
});

test('movePlayerInPlan auto-unassigns existing player in target on-field position to Bench', () => {
    const state = setup([
        ['A', { onField: true, position: 'Defense Left' }],
        ['B', { onField: false }],
        ['C', { onField: true, position: 'Midfield Left' }]
    ]);
    // Move B from Bench into Defense Left -> A is displaced to Bench
    movePlayerInPlan(state, state.roster[1].id, 'Defense Left');
    assert.equal(state.subPlan[state.roster[1].id], 'Defense Left');
    assert.equal(state.subPlan[state.roster[0].id], BENCH);

    // Move C into Defense Left -> B is displaced to Bench
    movePlayerInPlan(state, state.roster[2].id, 'Defense Left');
    assert.equal(state.subPlan[state.roster[2].id], 'Defense Left');
    assert.equal(state.subPlan[state.roster[1].id], BENCH);
});

test('executeSubPlan applies changes, resets long-bench stints, records sub-out time', () => {
    const state = setup([
        ['Out', { onField: true, position: 'Offense Left', currentStintTime: 40000 }],
        ['In', { onField: false, lastSubOutGameTime: 0, currentStintTime: 25000 }],
        ['QuickIn', { onField: false, lastSubOutGameTime: 45000, currentStintTime: 15000 }]
    ]);
    state.accumulatedGameTime = 60000;
    state.subPlan = {
        [state.roster[0].id]: BENCH,
        [state.roster[1].id]: 'Defense Left',
        [state.roster[2].id]: 'Midfield Left'
    };
    executeSubPlan(state);
    const [out, inP, quick] = state.roster;
    assert.equal(out.onField, false);
    assert.equal(out.lastSubOutGameTime, 60000);
    assert.equal(inP.onField, true);
    assert.equal(inP.position, 'Defense Left');
    assert.equal(inP.currentStintTime, 0); // bench >= 30s: stint reset
    assert.equal(quick.position, 'Midfield Left');
    assert.equal(quick.currentStintTime, 15000); // bench < 30s: stint kept
    assert.equal(state.subPlan, null);
});

test('executeSubPlan is a no-op without a plan', () => {
    const state = setup([['A', { onField: true, position: 'Offense Left' }]]);
    executeSubPlan(state);
    assert.equal(state.roster[0].position, 'Offense Left');
});

test('clearSubPlan removes the plan', () => {
    const state = setup([['A']]);
    state.subPlan = { [state.roster[0].id]: BENCH };
    clearSubPlan(state);
    assert.equal(state.subPlan, null);
});

test('getSortedOnField sorts by position order, then longest stint first', () => {
    const state = setup([
        ['MidRight', { onField: true, position: 'Midfield Right', currentStintTime: 90000 }],
        ['DefLeft', { onField: true, position: 'Defense Left', currentStintTime: 1000 }],
        ['MidLeft', { onField: true, position: 'Midfield Left', currentStintTime: 500 }]
    ]);
    const stint = Object.fromEntries(state.roster.map(p => [p.id, p.currentStintTime]));
    const sorted = getSortedOnField(state, stint);
    assert.deepEqual(sorted.map(p => p.name), ['DefLeft', 'MidLeft', 'MidRight']);
});

test('getSortedBench: longest bench first, then least play time, then name', () => {
    const state = setup([
        ['Zed', { onField: false, lastSubOutGameTime: 0, totalPlayTime: 0 }],
        ['Amy', { onField: false, lastSubOutGameTime: 0, totalPlayTime: 0 }],
        ['Bob', { onField: false, lastSubOutGameTime: 10000, totalPlayTime: 50000 }]
    ]);
    state.accumulatedGameTime = 20000;
    const bench = { [state.roster[0].id]: 20000, [state.roster[1].id]: 20000, [state.roster[2].id]: 10000 };
    const times = { [state.roster[0].id]: 0, [state.roster[1].id]: 0, [state.roster[2].id]: 50000 };
    const sorted = getSortedBench(state, times, bench);
    assert.deepEqual(sorted.map(p => p.name), ['Amy', 'Zed', 'Bob']);
});
