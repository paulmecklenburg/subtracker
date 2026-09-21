// Single source of truth for positions: order, display short names, CSS classes, colors.
export const POSITIONS = ['Unassigned', 'Goalie', 'Defense', 'Midfield', 'Offense'];
export const BENCH = 'Bench';

export const POS_MAP = {
    'Unassigned': { short: '-', class: 'pos-u', color: '#bdc3c7' },
    'Goalie': { short: 'G', class: 'pos-g', color: '#f39c12' },
    'Defense': { short: 'D', class: 'pos-d', color: '#2980b9' },
    'Midfield': { short: 'M', class: 'pos-m', color: '#27ae60' },
    'Offense': { short: 'O', class: 'pos-o', color: '#c0392b' },
    'Bench': { short: 'B', class: 'pos-bench', color: '#3498db' }
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
