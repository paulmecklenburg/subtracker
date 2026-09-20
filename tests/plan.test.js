import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createPlayer, syncState } from '../js/state.js';
import {
    getCurrentSlot, getPlannedSlot, getPlannedChanges, arePositionsActive,
    generateDefaultSubPlan, executeSubPlan, clearSubPlan, movePlayerInPlan,
    getSortedOnField, getSortedBench
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
    const a = makePlayer('A', { onField: true, position: 'Defense' });
    const b = makePlayer('B', { onField: false });
    assert.equal(getCurrentSlot(a), 'Defense');
    assert.equal(getCurrentSlot(b), BENCH);
});

test('getPlannedSlot falls back to current slot when no plan entry', () => {
    const state = setup([['A', { onField: true, position: 'Defense' }]]);
    state.subPlan = {};
    assert.equal(getPlannedSlot(state, state.roster[0]), 'Defense');
});

test('getPlannedChanges lists only players whose slot changes', () => {
    const state = setup([
        ['A', { onField: true, position: 'Offense' }],
        ['B', { onField: false }],
        ['C', { onField: true, position: 'Defense' }]
    ]);
    state.subPlan = {
        [state.roster[0].id]: BENCH,      // change
        [state.roster[1].id]: 'Defense',  // change
        [state.roster[2].id]: 'Defense'   // same
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
    assert.equal(arePositionsActive(setup([['A', { onField: false, position: 'Defense' }]])), false);
    assert.equal(arePositionsActive(setup([['A', { onField: true, position: 'Defense' }]])), true);
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

test('generateDefaultSubPlan with positions: offense out, bench to defense, shift up', () => {
    const state = setup([
        ['Off1', { onField: true, position: 'Offense', currentStintTime: 50000 }],
        ['Off2', { onField: true, position: 'Offense', currentStintTime: 40000 }],
        ['Mid1', { onField: true, position: 'Midfield', currentStintTime: 30000 }],
        ['Def1', { onField: true, position: 'Defense', currentStintTime: 20000 }],
        ['Goal', { onField: true, position: 'Goalie', currentStintTime: 10000 }],
        ['Bench1', { onField: false, lastSubOutGameTime: 0 }],
        ['Bench2', { onField: false, lastSubOutGameTime: 1000 }]
    ]);
    state.accumulatedGameTime = 50000;
    syncState(state, Date.now()); // no-op, clock not running
    generateDefaultSubPlan(state);
    const byName = Object.fromEntries(state.roster.map(p => [p.name, state.subPlan[p.id]]));
    // Two bench players in, two offense players out.
    assert.equal(byName['Off1'], BENCH);
    assert.equal(byName['Off2'], BENCH);
    assert.equal(byName['Bench1'], 'Defense');
    assert.equal(byName['Bench2'], 'Defense');
    // Field shifts up.
    assert.equal(byName['Def1'], 'Midfield');
    assert.equal(byName['Mid1'], 'Offense');
    // Goalie untouched.
    assert.equal(byName['Goal'], 'Goalie');
});

test('movePlayerInPlan creates plan lazily covering all present players', () => {
    const state = setup([
        ['A', { onField: true, position: 'Defense' }],
        ['B', { onField: false }],
        ['Gone', { isPresent: false }]
    ]);
    movePlayerInPlan(state, state.roster[1].id, 'Goalie');
    assert.equal(state.subPlan[state.roster[1].id], 'Goalie');
    assert.equal(state.subPlan[state.roster[0].id], 'Defense'); // baseline entry created
    assert.equal(state.subPlan[state.roster[2].id], undefined); // absent excluded
});

test('executeSubPlan applies changes, resets long-bench stints, records sub-out time', () => {
    const state = setup([
        ['Out', { onField: true, position: 'Offense', currentStintTime: 40000 }],
        ['In', { onField: false, lastSubOutGameTime: 0, currentStintTime: 25000 }],
        ['QuickIn', { onField: false, lastSubOutGameTime: 45000, currentStintTime: 15000 }]
    ]);
    state.accumulatedGameTime = 60000;
    state.subPlan = {
        [state.roster[0].id]: BENCH,
        [state.roster[1].id]: 'Defense',
        [state.roster[2].id]: 'Midfield'
    };
    executeSubPlan(state);
    const [out, inP, quick] = state.roster;
    assert.equal(out.onField, false);
    assert.equal(out.lastSubOutGameTime, 60000);
    assert.equal(inP.onField, true);
    assert.equal(inP.position, 'Defense');
    assert.equal(inP.currentStintTime, 0); // bench >= 30s: stint reset
    assert.equal(quick.position, 'Midfield');
    assert.equal(quick.currentStintTime, 15000); // bench < 30s: stint kept
    assert.equal(state.subPlan, null);
});

test('executeSubPlan is a no-op without a plan', () => {
    const state = setup([['A', { onField: true, position: 'Offense' }]]);
    executeSubPlan(state);
    assert.equal(state.roster[0].position, 'Offense');
});

test('clearSubPlan removes the plan', () => {
    const state = setup([['A']]);
    state.subPlan = { [state.roster[0].id]: BENCH };
    clearSubPlan(state);
    assert.equal(state.subPlan, null);
});

test('getSortedOnField sorts by position order, then longest stint first', () => {
    const state = setup([
        ['MidOld', { onField: true, position: 'Midfield', currentStintTime: 90000 }],
        ['DefNew', { onField: true, position: 'Defense', currentStintTime: 1000 }],
        ['MidNew', { onField: true, position: 'Midfield', currentStintTime: 500 }]
    ]);
    const stint = Object.fromEntries(state.roster.map(p => [p.id, p.currentStintTime]));
    const sorted = getSortedOnField(state, stint);
    assert.deepEqual(sorted.map(p => p.name), ['DefNew', 'MidOld', 'MidNew']);
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
