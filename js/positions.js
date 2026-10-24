// Single source of truth for positions: order, display short names, CSS classes, colors.
export const POSITIONS = [
    'Unassigned',
    'Goalie',
    'Defense Left',
    'Defense Right',
    'Midfield Left',
    'Midfield Right',
    'Offense Left',
    'Offense Right'
];
export const BENCH = 'Bench';

// On-field positions that only allow one player at a time.
export const SINGLE_PLAYER_POSITIONS = POSITIONS.filter(p => p !== 'Unassigned');

export const POS_MAP = {
    'Unassigned': { short: '-', class: 'pos-u', color: '#bdc3c7', marker: 'unassigned' },
    'Goalie': { short: 'G', class: 'pos-g', color: '#f39c12', marker: 'goalie' },
    'Defense Left': { short: 'DL', class: 'pos-d', color: '#2980b9', marker: 'defense' },
    'Defense Right': { short: 'DR', class: 'pos-d', color: '#2980b9', marker: 'defense' },
    'Midfield Left': { short: 'ML', class: 'pos-m', color: '#27ae60', marker: 'midfield' },
    'Midfield Right': { short: 'MR', class: 'pos-m', color: '#27ae60', marker: 'midfield' },
    'Offense Left': { short: 'OL', class: 'pos-o', color: '#c0392b', marker: 'offense' },
    'Offense Right': { short: 'OR', class: 'pos-o', color: '#c0392b', marker: 'offense' },
    'Bench': { short: 'B', class: 'pos-bench', color: '#3498db', marker: 'bench' }
};

export function posData(position) {
    return POS_MAP[position] || POS_MAP['Unassigned'];
}

// Escape a string for safe interpolation into innerHTML.
export function escapeHtml(s) {
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function newId() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}
