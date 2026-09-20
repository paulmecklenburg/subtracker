# subtracker
Tool to track player game time for fair substitutions.

Static site (no build step): deploy the repo root as-is (e.g. GitHub Pages).
Note: as an ES-module app it must be served over HTTP; use `npm run serve` to run locally.

## Development
- `npm test` — run the unit tests (Node built-in test runner, no dependencies)
- `npm run serve` — local web server at http://localhost:8000

Code layout: `js/positions.js` (shared config), `js/state.js` (persistence + time math),
`js/plan.js` (substitution plan logic), `js/ui.js` (rendering/DOM), `js/main.js` (wiring).
Only `state.js` and `plan.js` are imported by tests; they must stay DOM-free.

