// State Management
let state = {
    gameRunning: false,
    accumulatedGameTime: 0,
    lastSyncTimestamp: null,
    lastUpdate: Date.now(),
    roster: [] // { id, name, onField: false, totalPlayTime: 0 }
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
                p.onField = false;
            });
        }
        state = parsed;
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
        }, {})
    };
}

function syncState() {
    if (state.gameRunning && state.lastSyncTimestamp) {
        const now = Date.now();
        const delta = now - state.lastSyncTimestamp;
        state.accumulatedGameTime += delta;
        state.roster.forEach(p => {
            if (p.onField) p.totalPlayTime += delta;
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
const toggleBtn = document.getElementById('toggle-btn');
const onFieldListEl = document.getElementById('on-field-list');
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
        if (p.onField) p.totalPlayTime = Math.max(0, p.totalPlayTime - rewindMs);
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
            totalPlayTime: 0
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

function subPlayer(id) {
    syncState();
    const player = state.roster.find(p => p.id === id);
    if (player) {
        player.onField = !player.onField;
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
            p.onField = false;
        });
        saveState();
        render();
    }
}

// Rendering
function render() {
    const { gameTime, playerTimes } = getLiveTimes();
    
    // Update Clock
    stopwatchEl.textContent = formatTime(gameTime);
    toggleBtn.textContent = state.gameRunning ? 'Pause' : 'Start';
    toggleBtn.className = state.gameRunning ? 'btn-secondary' : 'btn-primary';

    // Sort Players
    const onField = state.roster.filter(p => p.onField)
        .sort((a, b) => playerTimes[b.id] - playerTimes[a.id]); // Most played at top
    const bench = state.roster.filter(p => !p.onField)
        .sort((a, b) => playerTimes[a.id] - playerTimes[b.id]); // Least played at top

    // Render Lists
    renderPlayerList(onFieldListEl, onField, playerTimes, 'Sub Out', 'on-field-card');
    renderPlayerList(benchListEl, bench, playerTimes, 'Sub In', 'bench-card');
    
    // Admin Roster
    rosterListEl.innerHTML = '';
    state.roster.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${p.name}</span>
            <button class="remove-player-btn" data-id="${p.id}">✕</button>
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

function renderPlayerList(container, players, times, btnText, cardClass) {
    container.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-card ${cardClass}`;
        const isRunning = state.gameRunning && p.onField;
        div.innerHTML = `
            <div class="player-info">
                <span class="player-name">${p.name}</span>
                <span class="player-time ${isRunning ? 'pulsing' : ''}">${formatTime(times[p.id])}</span>
            </div>
            <button class="sub-btn ${p.onField ? 'btn-secondary' : 'btn-primary'}" data-id="${p.id}">${btnText}</button>
        `;
        container.appendChild(div);
    });
}

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
});

// Init
loadState();
render();
setInterval(render, 1000); // Update UI every second
