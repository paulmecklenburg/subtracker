// State Management
const POSITIONS = ['Unassigned', 'Goalie', 'Defense', 'Midfield', 'Offense'];

let state = {
    gameRunning: false,
    accumulatedGameTime: 0,
    lastSyncTimestamp: null,
    lastUpdate: Date.now(),
    roster: [] // { id, name, onField: false, totalPlayTime: 0, currentStintTime: 0, lastSubOutGameTime: 0, isPresent: true, position: 'Unassigned' }
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
            parsed.roster.forEach(p => {
                p.totalPlayTime = 0;
                p.currentStintTime = 0;
                p.lastSubOutGameTime = 0;
                p.onField = false;
                p.position = 'Unassigned';
            });
        }
        state = parsed;
        // Migration: Ensure all players have needed properties
        state.roster.forEach(p => {
            if (p.isPresent === undefined) p.isPresent = true;
            if (p.currentStintTime === undefined) p.currentStintTime = 0;
            if (p.lastSubOutGameTime === undefined) p.lastSubOutGameTime = 0;
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
    
    return {
        gameTime: Math.max(0, state.accumulatedGameTime + delta),
        playerTimes: state.roster.reduce((acc, p) => {
            acc[p.id] = Math.max(0, p.totalPlayTime + (state.gameRunning && p.onField ? delta : 0));
            return acc;
        }, {}),
        stintTimes: state.roster.reduce((acc, p) => {
            acc[p.id] = Math.max(0, p.currentStintTime + (state.gameRunning && p.onField ? delta : 0));
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
                p.totalPlayTime += delta;
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
const adminToggle = document.getElementById('admin-toggle');
const adminContent = document.getElementById('admin-content');
const rosterListEl = document.getElementById('roster-list');
const playerNameInput = document.getElementById('player-name');
const addBtn = document.getElementById('add-btn');
const resetBtn = document.getElementById('reset-btn');
const rewindBtn = document.getElementById('rewind-btn');

// Actions
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
            p.totalPlayTime = Math.max(0, p.totalPlayTime - rewindMs);
            p.currentStintTime = Math.max(0, p.currentStintTime - rewindMs);
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
            currentStintTime: 0,
            lastSubOutGameTime: 0,
            isPresent: true
        });
        playerNameInput.value = '';
        saveState();
        render();
    }
}

function removePlayer(id) {
    if (confirm('Remove player from roster?')) {
        state.roster = state.roster.filter(p => p.id !== id);
        saveState();
        render();
    }
}

function togglePresence(id) {
    const player = state.roster.find(p => p.id === id);
    if (player) {
        player.isPresent = !player.isPresent;
        if (!player.isPresent) {
            player.onField = false; // Player can't be on field if absent
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
            // Subbing in: reset stint time if enough time passed on bench
            const benchDuration = state.accumulatedGameTime - player.lastSubOutGameTime;
            if (benchDuration >= 30000) {
                player.currentStintTime = 0;
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
        state.roster.forEach(p => {
            p.totalPlayTime = 0;
            p.currentStintTime = 0;
            p.lastSubOutGameTime = 0;
            p.onField = false;
        });
        saveState();
        render();
    }
}

// Rendering
function render() {
    const { gameTime, playerTimes, stintTimes } = getLiveTimes();
    
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
    const onField = [...onFieldTotal].sort((a, b) => stintTimes[b.id] - stintTimes[a.id]); // Longest stint at top
    const bench = state.roster.filter(p => !p.onField && p.isPresent)
        .sort((a, b) => playerTimes[a.id] - playerTimes[b.id]); // Least played at top

    // Update Headers visibility and structure
    if (onField.length > 0) {
        onFieldHeaderEl.classList.remove('hidden');
        onFieldHeaderEl.classList.add('has-stint'); // Matches on-field-card layout
    } else {
        onFieldHeaderEl.classList.add('hidden');
    }

    // Render Lists
    renderPlayerList(onFieldListEl, onField, playerTimes, stintTimes, 'Sub Out', 'on-field-card');
    renderPlayerList(benchListEl, bench, playerTimes, null, 'Sub In', 'bench-card');
    
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

function renderPlayerList(container, players, times, stintTimes, btnText, cardClass) {
    container.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-card ${cardClass}`;
        const isRunning = state.gameRunning && p.onField;
        
        let stintHtml = '';
        let posHtml = '';
        if (stintTimes) {
            stintHtml = `<span class="player-time stint-time" title="Current Stint">${formatTime(stintTimes[p.id])}</span>`;
            posHtml = `<div class="pos-btn" data-id="${p.id}">${p.position || 'Unassigned'}</div>`;
            div.classList.add('has-stint');
        }

        div.innerHTML = `
            <span class="player-name">${p.name}</span>
            ${posHtml}
            <span class="player-time ${isRunning ? 'pulsing' : ''}" title="Total Time">${formatTime(times[p.id])}</span>
            ${stintHtml}
            <button class="sub-btn ${p.onField ? 'btn-secondary' : 'btn-primary'}" data-id="${p.id}">${btnText}</button>
        `;
        container.appendChild(div);
    });
}

// Position Management Logic
const positionDialog = document.getElementById('position-dialog');
const positionOptions = document.getElementById('position-options');
const closeDialog = document.getElementById('close-dialog');
let longPressTimer;
let currentPosPlayerId = null;

function cyclePosition(id) {
    const player = state.roster.find(p => p.id === id);
    if (player) {
        const currentIndex = POSITIONS.indexOf(player.position || 'Unassigned');
        const nextIndex = (currentIndex + 1) % POSITIONS.length;
        player.position = POSITIONS[nextIndex];
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
        btn.textContent = pos;
        if (player.position === pos) btn.style.borderColor = 'var(--primary)';
        btn.onclick = () => {
            player.position = pos;
            saveState();
            render();
            positionDialog.close();
        };
        positionOptions.appendChild(btn);
    });
    positionDialog.showModal();
}

closeDialog.onclick = () => positionDialog.close();

// Event Listeners for Long Press
document.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('pos-btn')) {
        const id = e.target.dataset.id;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            openPositionDialog(id);
        }, 500);
    }
});

document.addEventListener('mouseup', (e) => {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        if (e.target.classList.contains('pos-btn')) {
            cyclePosition(e.target.dataset.id);
        }
    }
});

document.addEventListener('touchstart', (e) => {
    if (e.target.classList.contains('pos-btn')) {
        const id = e.target.dataset.id;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            openPositionDialog(id);
        }, 500);
    }
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        if (e.target.classList.contains('pos-btn')) {
            cyclePosition(e.target.dataset.id);
        }
    }
});

// Event Listeners
toggleBtn.addEventListener('click', toggleClock);
rewindBtn.addEventListener('click', rewind);
addBtn.addEventListener('click', addPlayer);
resetBtn.addEventListener('click', resetGame);
adminToggle.addEventListener('click', () => adminContent.classList.toggle('hidden'));

document.addEventListener('click', (e) => {
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

// Init
loadState();
render();
setInterval(render, 1000); // Update UI every second
