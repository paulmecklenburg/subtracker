import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createInitialState, createPlayer, loadState, saveState, resetTimes,
    getLiveTimes, syncState, toggleClock, togglePresence, subPlayer, adjustAllTimes
} from '../js/state.js';

// Minimal localStorage stub.
function fakeStorage() {
    const map = new Map();
    return {
        getItem: k => map.has(k) ? map.get(k) : null,
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k)
    };
}

// Deterministic clock.
function fakeClock(start = 1000000) {
    let now = start;
    return {
        now: () => now,
        advance: ms => { now += ms; }
    };
}

function makePlayer(name = 'Alice', overrides = {}) {
    return { ...createPlayer(name, 0), ...overrides };
}

test('getLiveTimes: game not running means no delta applied', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: true, totalPlayTime: 60000, currentStintTime: 30000 })];
    const t1 = getLiveTimes(state, clock.now());
    clock.advance(5000);
    const t2 = getLiveTimes(state, clock.now());
    assert.equal(t2.gameTime, 0);
    assert.equal(t2.playerTimes[state.roster[0].id], 60000);
    assert.equal(t2.stintTimes[state.roster[0].id], 30000);
});

test('getLiveTimes: running clock accrues game and player time', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: true, position: 'Defense' })];
    toggleClock(state, clock.now());
    clock.advance(10000);
    const t = getLiveTimes(state, clock.now());
    assert.equal(t.gameTime, 10000);
    assert.equal(t.playerTimes[state.roster[0].id], 10000);
    assert.equal(t.stintTimes[state.roster[0].id], 10000);
    assert.equal(t.goalieTimes[state.roster[0].id], 0);
});

test('getLiveTimes: goalie time goes to goalieTimes, not playerTimes', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [makePlayer('G', { onField: true, position: 'Goalie' })];
    toggleClock(state, clock.now());
    clock.advance(20000);
    const t = getLiveTimes(state, clock.now());
    assert.equal(t.goalieTimes[state.roster[0].id], 20000);
    assert.equal(t.playerTimes[state.roster[0].id], 0);
});

test('getLiveTimes: bench time counts from lastSubOutGameTime', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: false, lastSubOutGameTime: 5000 })];
    state.accumulatedGameTime = 5000;
    toggleClock(state, clock.now());
    clock.advance(3000); // game time now 8000
    const t = getLiveTimes(state, clock.now());
    assert.equal(t.benchTimes[state.roster[0].id], 3000);
});

test('syncState folds pending delta into stored totals', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [
        makePlayer('A', { onField: true, position: 'Defense' }),
        makePlayer('B', { onField: true, position: 'Goalie' }),
        makePlayer('C', { onField: false })
    ];
    toggleClock(state, clock.now());
    clock.advance(12000);
    syncState(state, clock.now());
    assert.equal(state.accumulatedGameTime, 12000);
    assert.equal(state.roster[0].totalPlayTime, 12000);
    assert.equal(state.roster[1].goaliePlayTime, 12000);
    assert.equal(state.roster[2].totalPlayTime, 0);
    // No double-count after sync.
    const t = getLiveTimes(state, clock.now());
    assert.equal(t.gameTime, 12000);
});

test('toggleClock pause folds time then stops', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: true })];
    toggleClock(state, clock.now());
    clock.advance(7000);
    toggleClock(state, clock.now());
    assert.equal(state.accumulatedGameTime, 7000);
    assert.equal(state.gameRunning, false);
    clock.advance(60000);
    assert.equal(getLiveTimes(state, clock.now()).gameTime, 7000);
});

test('togglePresence on on-field player does not lose accrued time', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: true })];
    toggleClock(state, clock.now());
    clock.advance(9000);
    togglePresence(state, state.roster[0].id, clock.now());
    assert.equal(state.roster[0].isPresent, false);
    assert.equal(state.roster[0].onField, false);
    assert.equal(state.roster[0].totalPlayTime, 9000);
});

test('subPlayer: subbing in after short bench keeps stint and position', () => {
    const clock = fakeClock();
    const state = createInitialState();
    state.accumulatedGameTime = 0;
    const p = makePlayer('A', { onField: false, lastSubOutGameTime: 0, currentStintTime: 10000, position: 'Midfield' });
    state.roster = [p];
    subPlayer(state, p.id, clock.now(), 30000);
    assert.equal(p.onField, true);
    assert.equal(p.currentStintTime, 10000); // stint not reset
    assert.equal(p.position, 'Midfield'); // position kept
});

test('subPlayer: subbing in after long bench resets stint and position', () => {
    const clock = fakeClock();
    const state = createInitialState();
    const p = makePlayer('A', { onField: false, lastSubOutGameTime: 0, currentStintTime: 20000, position: 'Midfield' });
    state.roster = [p];
    state.accumulatedGameTime = 60000;
    subPlayer(state, p.id, clock.now(), 30000);
    assert.equal(p.onField, true);
    assert.equal(p.currentStintTime, 0);
    assert.equal(p.position, 'Unassigned');
});

test('subPlayer: subbing out records lastSubOutGameTime', () => {
    const clock = fakeClock();
    const state = createInitialState();
    const p = makePlayer('A', { onField: true });
    state.roster = [p];
    state.accumulatedGameTime = 45000;
    subPlayer(state, p.id, clock.now());
    assert.equal(p.onField, false);
    assert.equal(p.lastSubOutGameTime, 45000);
});

test('adjustAllTimes: rewind reduces clocks, clamps at zero, clamps lastSubOutGameTime', () => {
    const state = createInitialState();
    state.accumulatedGameTime = 10000;
    state.roster = [
        makePlayer('A', { onField: true, totalPlayTime: 10000, currentStintTime: 4000 }),
        makePlayer('B', { onField: false, lastSubOutGameTime: 9000 })
    ];
    adjustAllTimes(state, -30000);
    assert.equal(state.accumulatedGameTime, 0);
    assert.equal(state.roster[0].totalPlayTime, 0);
    assert.equal(state.roster[0].currentStintTime, 0);
    assert.equal(state.roster[1].lastSubOutGameTime, 0);
});

test('adjustAllTimes: fast forward adds to on-field clocks', () => {
    const state = createInitialState();
    state.accumulatedGameTime = 10000;
    state.roster = [
        makePlayer('A', { onField: true, position: 'Goalie', goaliePlayTime: 5000, currentStintTime: 5000 }),
        makePlayer('B', { onField: false })
    ];
    adjustAllTimes(state, 30000);
    assert.equal(state.accumulatedGameTime, 40000);
    assert.equal(state.roster[0].goaliePlayTime, 35000);
    assert.equal(state.roster[0].currentStintTime, 35000);
    assert.equal(state.roster[1].goaliePlayTime, 0);
});

test('resetTimes zeroes everything but keeps roster and preferences', () => {
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: true, totalPlayTime: 999, position: 'Offense' })];
    state.gameRunning = true;
    state.accumulatedGameTime = 999;
    state.subPlan = { [state.roster[0].id]: 'Bench' };
    state.forcePositions = true;
    resetTimes(state);
    assert.equal(state.gameRunning, false);
    assert.equal(state.accumulatedGameTime, 0);
    assert.equal(state.subPlan, null);
    assert.equal(state.forcePositions, true);
    assert.equal(state.roster.length, 1);
    assert.equal(state.roster[0].totalPlayTime, 0);
    assert.equal(state.roster[0].onField, false);
    assert.equal(state.roster[0].position, 'Unassigned');
});

test('saveState/loadState round-trips', () => {
    const storage = fakeStorage();
    const clock = fakeClock();
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: true, totalPlayTime: 12345 })];
    saveState(state, storage, clock.now());
    const loaded = loadState(storage, clock.now());
    assert.equal(loaded.roster.length, 1);
    assert.equal(loaded.roster[0].name, 'A');
    assert.equal(loaded.roster[0].totalPlayTime, 12345);
    assert.equal(loaded.roster[0].onField, true);
});

test('saveState strips transient needsFlash before serializing', () => {
    const storage = fakeStorage();
    const clock = fakeClock();
    const state = createInitialState();
    const player = makePlayer('A', { needsFlash: true });
    state.roster = [player];
    saveState(state, storage, clock.now());
    const savedJson = storage.getItem('subtracker_state');
    assert.equal(savedJson.includes('needsFlash'), false);
    const loaded = loadState(storage, clock.now());
    assert.equal(loaded.roster[0].needsFlash, undefined);
});

test('loadState: corrupted JSON falls back to fresh state', () => {
    const storage = fakeStorage();
    storage.setItem('subtracker_state', '{not json');
    const loaded = loadState(storage);
    assert.equal(loaded.roster.length, 0);
    assert.equal(loaded.gameRunning, false);
});

test('loadState: non-object JSON falls back to fresh state', () => {
    const storage = fakeStorage();
    storage.setItem('subtracker_state', '42');
    assert.equal(loadState(storage).roster.length, 0);
});

test('loadState: invalid subPlan is dropped', () => {
    const storage = fakeStorage();
    const state = createInitialState();
    state.roster = [makePlayer('A')];
    state.subPlan = 'bogus';
    saveState(state, storage);
    assert.equal(loadState(storage).subPlan, null);
});

test('loadState: auto-resets after 24 hours', () => {
    const storage = fakeStorage();
    const state = createInitialState();
    state.roster = [makePlayer('A', { onField: true, totalPlayTime: 5000 })];
    state.accumulatedGameTime = 5000;
    state.gameRunning = true;
    state.lastUpdate = Date.now() - 25 * 60 * 60 * 1000;
    saveState(state, storage, state.lastUpdate);
    const loaded = loadState(storage, Date.now());
    assert.equal(loaded.accumulatedGameTime, 0);
    assert.equal(loaded.gameRunning, false);
    assert.equal(loaded.roster[0].totalPlayTime, 0);
    assert.equal(loaded.roster.length, 1); // roster kept
});

test('loadState: migrates legacy players missing fields', () => {
    const storage = fakeStorage();
    storage.setItem('subtracker_state', JSON.stringify({
        gameRunning: false,
        accumulatedGameTime: 0,
        lastSyncTimestamp: null,
        roster: [{ id: 'x', name: 'Old' }]
    }));
    const loaded = loadState(storage);
    const p = loaded.roster[0];
    assert.equal(p.isPresent, true);
    assert.equal(p.totalPlayTime, 0);
    assert.equal(p.goaliePlayTime, 0);
    assert.equal(p.currentStintTime, 0);
    assert.equal(p.lastSubOutGameTime, 0);
    assert.equal(p.position, 'Unassigned');
    assert.equal(p.onField, false);
});

test('loadState: defaults forcePositions to false for legacy saves', () => {
    const storage = fakeStorage();
    storage.setItem('subtracker_state', JSON.stringify({
        gameRunning: false,
        accumulatedGameTime: 0,
        lastSyncTimestamp: null,
        roster: []
    }));
    const loaded = loadState(storage);
    assert.equal(loaded.forcePositions, false);

    // Round-trip: an explicitly enabled toggle persists via a plain load
    // (lastUpdate recent, so the 24h auto-reset branch is not taken).
    storage.setItem('subtracker_state', JSON.stringify({ roster: [], forcePositions: true, lastUpdate: Date.now() }));
    assert.equal(loadState(storage).forcePositions, true);
});
