# Gomoku

Five in a row on a go board, in a timber cabin in the snowy mountains at dusk. Play a bot (easy to expert) or a friend on the same device, in the browser.

The 3D scene uses Three.js; the bot (alpha-beta search with threat detection) runs in a Web Worker, so everything is static and needs no server.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm test` runs the rules and bot tests; `npm run build` writes a static site to `dist/`.

## Play

Click an intersection to place a stone. Black moves first; five or more in a row in any direction wins. Drag to look around, scroll or pinch to zoom, or use the arrow keys and Enter. Undo takes back your last move (and the bot's reply).

Development notes are in `docs/PROGRESS.md`.
