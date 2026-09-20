// State Management
const POSITIONS = ['Unassigned', 'Goalie', 'Defense', 'Midfield', 'Offense'];

let state = {
    gameRunning: false,
    accumulatedGameTime: 0,
    lastSyncTimestamp: null,
    lastUpdate: Date.now(),
    roster: [], // { id, name, onField: false, totalPlayTime: 0, goaliePlayTime: 0, currentStintTime: 0, lastSubOutGameTime: 0, isPresent: true, position: 'Unassigned' }
    pendingSubs: {} // { [playerId]: { action: 'sub_in' | 'sub_out' | 'change_pos', position?: string } }
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
            parsed.pendingSubs = {};
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
        if (!state.pendingSubs || typeof state.pendingSubs !== 'object') {
            state.pendingSubs = {};
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
const queueSectionEl = document.getElementById('queue-section');
const queueSummaryEl = document.getElementById('queue-summary');
const executeSubsBtn = document.getElementById('execute-subs-btn');
const cancelQueueBtn = document.getElementById('cancel-queue-btn');
const autoQueueBtn = document.getElementById('auto-queue-btn');
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

// Queue Management Logic
function isQueueActive() {
    return !!(state.pendingSubs && Object.keys(state.pendingSubs).length > 0);
}

function autoQueueRotation() {
    syncState();
    const { playerTimes, stintTimes, benchTimes } = getLiveTimes();
    const onField = state.roster.filter(p => p.onField && p.isPresent);
    const bench = getSortedBench(playerTimes, benchTimes);

    if (onField.length === 0) {
        alert('No players currently on field to rotate.');
        return;
    }
    if (bench.length === 0) {
        alert('No bench players available to rotate in.');
        return;
    }

    const offensePlayers = onField.filter(p => p.position === 'Offense')
        .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));

    const eligibleOnField = onField.filter(p => p.position !== 'Goalie')
        .sort((a, b) => (stintTimes[b.id] || 0) - (stintTimes[a.id] || 0));

    if (eligibleOnField.length === 0) {
        alert('No eligible field players to rotate.');
        return;
    }

    // Only Offense players rotate out to the bench.
    // (If no players are assigned Offense yet, fallback to longest-stint field players).
    const candidateOut = offensePlayers.length > 0 ? offensePlayers : eligibleOnField;
    const numSubs = Math.min(candidateOut.length, bench.length);

    if (numSubs === 0) {
        alert('No players available to rotate.');
        return;
    }

    const subsOut = candidateOut.slice(0, numSubs);
    const subsIn = bench.slice(0, numSubs);
    const newPending = {};

    // Offense -> Bench
    subsOut.forEach(p => {
        newPending[p.id] = { action: 'sub_out' };
    });

    // Bench -> Defense
    subsIn.forEach(p => {
        newPending[p.id] = { action: 'sub_in', position: 'Defense' };
    });

    // Field shifts: Defense -> Midfield, Midfield -> Offense (Goalie and Unassigned remain)
    onField.forEach(p => {
        if (newPending[p.id]) return; // already subbing out
        if (p.position === 'Goalie' || p.position === 'Unassigned') return;

        if (p.position === 'Defense') {
            newPending[p.id] = { action: 'change_pos', position: 'Midfield' };
        } else if (p.position === 'Midfield') {
            newPending[p.id] = { action: 'change_pos', position: 'Offense' };
        }
    });

    state.pendingSubs = newPending;
    saveState();
    render();
}

function executeSubs() {
    if (!isQueueActive()) return;
    syncState();
    const execTime = state.accumulatedGameTime;

    Object.entries(state.pendingSubs).forEach(([id, pending]) => {
        const player = state.roster.find(p => p.id === id);
        if (!player || !player.isPresent) return;

        if (pending.action === 'sub_out') {
            player.onField = false;
            player.lastSubOutGameTime = execTime;
        } else if (pending.action === 'sub_in') {
            const benchDuration = execTime - player.lastSubOutGameTime;
            if (benchDuration >= 30000) {
                player.currentStintTime = 0;
            }
            player.onField = true;
            player.position = pending.position || 'Defense';
        } else if (pending.action === 'change_pos') {
            player.position = pending.position || player.position;
        }
    });

    state.pendingSubs = {};
    saveState();
    render();
}

function cancelQueue() {
    state.pendingSubs = {};
    saveState();
    render();
}

function toggleQueuePlayer(id) {
    if (!state.pendingSubs) state.pendingSubs = {};
    const player = state.roster.find(p => p.id === id);
    if (!player || !player.isPresent) return;

    const pending = state.pendingSubs[id];
    if (pending) {
        if (pending.action === 'change_pos') {
            pending.action = 'sub_out';
            delete pending.position;
        } else {
            delete state.pendingSubs[id];
        }
    } else {
        if (player.onField) {
            state.pendingSubs[id] = { action: 'sub_out' };
        } else {
            state.pendingSubs[id] = { action: 'sub_in', position: 'Defense' };
        }
    }
    saveState();
    render();
}

function cycleQueuedPosition(id) {
    if (!state.pendingSubs || !state.pendingSubs[id]) return;
    const pending = state.pendingSubs[id];
    const player = state.roster.find(p => p.id === id);
    if (!player) return;

    const cycleOrder = ['Defense', 'Midfield', 'Offense', 'Goalie', 'Unassigned'];

    if (player.onField) {
        if (pending.action === 'sub_out') {
            pending.action = 'change_pos';
            pending.position = 'Defense';
        } else if (pending.action === 'change_pos') {
            const currIdx = cycleOrder.indexOf(pending.position || 'Defense');
            if (currIdx === cycleOrder.length - 1) {
                pending.action = 'sub_out';
                delete pending.position;
            } else {
                pending.position = cycleOrder[currIdx + 1];
            }
        }
    } else {
        const currIdx = cycleOrder.indexOf(pending.position || 'Defense');
        const nextIdx = (currIdx + 1) % cycleOrder.length;
        pending.position = cycleOrder[nextIdx];
    }

    saveState();
    render();
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
        if (state.pendingSubs && state.pendingSubs[id]) {
            delete state.pendingSubs[id];
        }
        saveState();
        render();
    }
}

function togglePresence(id) {
    const player = state.roster.find(p => p.id === id);
    if (player) {
        player.isPresent = !player.isPresent;
        if (state.pendingSubs && state.pendingSubs[id]) {
            delete state.pendingSubs[id];
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
        state.pendingSubs = {};
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

    // Update Queue Section Banner
    if (isQueueActive()) {
        queueSectionEl.classList.remove('hidden');
        const subInCount = Object.values(state.pendingSubs).filter(p => p.action === 'sub_in').length;
        const subOutCount = Object.values(state.pendingSubs).filter(p => p.action === 'sub_out').length;
        const shiftCount = Object.values(state.pendingSubs).filter(p => p.action === 'change_pos').length;
        const parts = [];
        if (subInCount > 0) parts.push(`${subInCount} In`);
        if (subOutCount > 0) parts.push(`${subOutCount} Out`);
        if (shiftCount > 0) parts.push(`${shiftCount} Shift`);
        queueSummaryEl.textContent = parts.length > 0 ? parts.join(', ') : '0 Queued';
    } else {
        queueSectionEl.classList.add('hidden');
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

        const pending = state.pendingSubs ? state.pendingSubs[p.id] : null;

        let secondaryHtml = '';
        let posHtml = '';
        const inPlanningMode = isQueueActive();
        let buttonText = p.onField ? (inPlanningMode ? 'Queue' : 'Sub Out') : (inPlanningMode ? 'Queue' : 'Sub In');
        let buttonClass = p.onField ? 'btn-secondary' : 'btn-primary';
        let queuedBadgeHtml = '';

        if (p.onField) {
            const posData = POS_MAP[p.position || 'Unassigned'] || POS_MAP['Unassigned'];
            
            if (pending) {
                if (pending.action === 'sub_out') {
                    div.classList.add('queued-out-card');
                    buttonText = inPlanningMode ? 'Cancel' : 'Sub Out';
                    buttonClass = 'btn-queued-out';
                    posHtml = `
                        <div class="pos-container">
                            <div class="pos-btn ${posData.class}" data-id="${p.id}">${posData.short}</div>
                            <span class="queue-target-badge queue-badge-out" data-id="${p.id}" title="Queued to Sub Out (Click to change)">➔ 🪑</span>
                        </div>
                    `;
                } else if (pending.action === 'change_pos') {
                    div.classList.add('queued-shift-card');
                    const targetPosData = POS_MAP[pending.position || 'Unassigned'] || POS_MAP['Unassigned'];
                    posHtml = `
                        <div class="pos-container">
                            <div class="pos-btn ${posData.class}" data-id="${p.id}">${posData.short}</div>
                            <span class="queue-target-badge ${targetPosData.class}" data-id="${p.id}" title="Queued Position: ${pending.position} (Click to cycle)">➔ ${targetPosData.short}</span>
                        </div>
                    `;
                }
            } else {
                posHtml = `<div class="pos-btn ${posData.class}" data-id="${p.id}">${posData.short}</div>`;
            }

            if (secondaryTimes) {
                secondaryHtml = `<span class="player-time stint-time" title="Current Stint">${formatTime(secondaryTimes[p.id])}</span>`;
            }
            div.classList.add('has-stint');
        } else {
            // Bench
            if (pending && pending.action === 'sub_in') {
                div.classList.add('queued-in-card');
                buttonText = inPlanningMode ? 'Cancel' : 'Sub In';
                buttonClass = 'btn-queued-in';
                const targetPosData = POS_MAP[pending.position || 'Defense'] || POS_MAP['Defense'];
                queuedBadgeHtml = `<span class="queue-target-badge ${targetPosData.class}" data-id="${p.id}" title="Target Position: ${pending.position} (Click to cycle)">➔ ${targetPosData.short}</span>`;
            }

            if (secondaryTimes) {
                secondaryHtml = `<span class="player-time bench-time" title="Time on Bench">${formatTime(secondaryTimes[p.id])}</span>`;
            }
        }

        div.innerHTML = `
            <span class="player-name"><span class="player-name-text">${p.name}</span>${goalieHtml}${queuedBadgeHtml}</span>
            ${posHtml}
            <span class="player-time ${isRunning ? 'pulsing' : ''}" title="Total Time">${formatTime(times[p.id])}</span>
            ${secondaryHtml}
            <button class="sub-btn ${buttonClass}" data-id="${p.id}">${buttonText}</button>
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

let subLongPressTimer = null;
let isSubLongPress = false;

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
    if (e.target.classList.contains('sub-btn') && !isQueueActive()) {
        isSubLongPress = false;
        const id = e.target.dataset.id;
        subLongPressTimer = setTimeout(() => {
            isSubLongPress = true;
            toggleQueuePlayer(id);
        }, 500);
    }
});

function cancelLongPress() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    if (subLongPressTimer) {
        clearTimeout(subLongPressTimer);
        subLongPressTimer = null;
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
if (autoQueueBtn) autoQueueBtn.addEventListener('click', autoQueueRotation);
if (executeSubsBtn) executeSubsBtn.addEventListener('click', executeSubs);
if (cancelQueueBtn) cancelQueueBtn.addEventListener('click', cancelQueue);

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('pos-btn')) {
        // Ignore the click if it was the result of a long press
        if (isLongPress) return;
        cyclePosition(e.target.dataset.id);
    }
    if (e.target.classList.contains('queue-target-badge')) {
        cycleQueuedPosition(e.target.dataset.id);
    }
    if (e.target.classList.contains('sub-btn')) {
        if (isSubLongPress) {
            isSubLongPress = false;
            return;
        }
        if (isQueueActive()) {
            toggleQueuePlayer(e.target.dataset.id);
        } else {
            subPlayer(e.target.dataset.id);
        }
    }
    if (e.target.classList.contains('remove-player-btn')) {
        removePlayer(e.target.dataset.id);
    }
    if (e.target.classList.contains('presence-checkbox')) {
        togglePresence(e.target.dataset.id);
    }
});

// Init
loadState();
render();
setInterval(render, 1000); // Update UI every second
