# Progress and handoff

Goal: a deployable web Gomoku (freestyle, 19x19, five or more in a row wins). A go board sits on the dining table of a timber cabin with a loft, at blue hour in snowy mountains. You play a bot with selectable difficulty, or a friend on the same device.

Stack: TypeScript + Vite + Three.js, static deploy, bot runs client-side in a Web Worker. Architecture rule: `core` and `ai` know nothing about rendering, `render` knows nothing about the bot; only `main.ts` ties them together.

Run `npm install`, `npm run dev` (http://localhost:5173), `npm test`, `npm run build`. `.claude/launch.json` lets the Claude desktop browser pane start the dev server.

## Engine (`src/core`)
- `board.ts`: 19x19 `Board` (Uint8Array), `lineThrough`, `winningLine`, `candidateMoves`. `game.ts`: `Game` with turn, history, status, `winLine`, `undo`, `reset`.

## Bot (`src/ai`)
- `engine.ts`: the bot's incremental board. Everything is scored through the 1020 five-cell "windows"; a window holding one colour only is a potential five, worth `WINDOW_VALUE[stones]`. Placing or removing a stone touches at most 20 windows, so the evaluation, the count of four-stone windows per side (immediate threats) and a Zobrist hash stay incremental. Also `orderedMoves` (attack + defence score per cell), `fiveCells` and `vcf` (victory by continuous fours, node-capped).
- `search.ts`: iterative-deepening negamax with alpha-beta and a transposition table. Forced replies to a four are searched without spending depth. At the root: win now, block a four, play a VCF if one exists, and (hard/expert) drop moves that let the opponent win by VCF.
- `difficulty.ts`: easy / medium / hard / expert (depth, width, time, VCF depth, blunder rate). `bot.ts`: `GomokuBot.chooseMove(moves)`. `bot.worker.ts` + `asyncBot.ts`: worker wrapper; aborting kills the worker.
- Measured (headless, alternating colours, short games): medium beat easy 7-1, hard beat medium 8-0, expert beat hard 6-0. Hard thinks up to ~1.5 s, expert ~3 s. Not tested against strong humans; no opening book; freestyle rules only (no renju restrictions).

## Browser
- `main.ts`: one play loop for every turn (ask the side to move, `game.play`, await the stone animation), per-game AbortController. Undo takes back the human's last move and the bot's reply (one move in two-player mode). Settings persist in localStorage (`gomoku.settings`).
- `ui/overlay.ts` + `style.css`: menu (Bot/Friend, difficulty, Black/White/Random), status pill with the bot's last move in board coordinates, Undo / New game / Settings, result banner (top centre, clear of the board).

## Scene (`src/render`)
Recreates the reference photo the user supplied (2026-10-10): vaulted timber great room, dark rafters and ridge beam, a loft with a timber railing across the back, gable window above it and a big two-pane window below, a glazed right wall, a built-in fireplace on the left wall with a log store and shelves, a long oak table in the foreground with upholstered chairs on the far side, sofa along the right glass, reading chair and floor lamp under the loft, snowy spruces and mountains outside.

Scene spec (metres; table centre at the origin, player on +z, back wall at -z):
- Room x -3.6..3.9, z -5.4..3.4, eaves 3.5, ridge 6.1. Loft floor 2.75, 1.6 deep. Table top 0.76, 2.8 x 1.3.
- Reference camera: eye ~1.6-1.7 m, 2.4 m behind the table centre, looking level at the loft; horizon about 45% from the top. This is the menu's establishing shot (`OVERVIEW` in `scene.ts`).
- Outside: level snow 3 m beyond the back glass, then the slope falls into a valley; spruces from ~13 m out (clearing straight ahead), denser valley forest to 140 m, mountains from 360 m.

Conflict resolved with the user: from the photo's camera a 19x19 board is too small to play, so the game is played "photo angle, closer" (`VIEW_OFFSET`, ~35 degrees down onto the board, lens shift keeps verticals upright). The menu shows the photo framing, and the camera flies down to the board when a game starts (and back up when the menu opens). Orbit and zoom stay available.

Modules: `cabin.ts` (room, roof, loft, windows, reflection-only glass shader, downlights), `fireplace.ts` (chimney breast, firebox with shader flames and sparks, log store, shelves), `goban.ts` (kaya board with an inked grid texture, biconvex lathe stones in instanced meshes, bowls, ghost, last-move ring, glowing win rings), `table.ts`, `props.ts` (sofa, chairs, books, candles, shelves, lamps), `outdoors.ts` (sky backdrop, mountains, ground, instanced spruces in 3 LODs, snowfall), `lighting.ts` (RectAreaLights for the sky through each window, downlights, a shadow-casting spot on the board), `input.ts` (raycast to the nearest intersection; arrows + Enter), `scene.ts` (renderer, bloom, camera views, environment bake: the room is captured twice by a CubeCamera and used as `scene.environment`).

Assets: the CC0 Poly Haven set from the connect-four-3d project (`public/assets`, listed in `public/assets/CREDITS.md`, ~14 MB). Nothing new was downloaded.

Performance: ~2.5 M triangles, ~216 draw calls per frame at 1280x720. Not yet measured on a phone.

## Verified in the browser pane
Overview vs reference side by side; camera move to the board; clicking intersections (projected screen points) places stones; bot replies; bot as Black opens at the centre; win detection, win rings and banner; Undo in bot and two-player games; portrait 390x844 framing (board fits the width). `npm run build` works.

## Next
- Visual gaps vs the reference: the near spruces are still faceted up close and less snow-laden; the sky is paler than the photo's deep blue; the table reads darker and more planked than the photo's honey oak; the dining chairs and loft furniture are simple shapes; no rug, no contact shadows/AO (GTAOPass if the GPU budget allows).
- Bot: opening book, threat-space search beyond VCF (VCT), tune difficulty against humans.
- Sound (stone click, fire crackle), move list / coordinates overlay, phone performance pass.

## Gotchas
- Python on Windows defaults to cp1252: pass `encoding='utf-8'` when scripting edits to these files.
- The browser pane stops rAF and ResizeObserver while hidden. In dev, `window.__view` has `frame()` and `resize()`; render with them and read `renderer.domElement.toDataURL()` in the same task.
- Instanced meshes created with zero instances keep stale bounds; set `frustumCulled = false` (stones, win rings) or they vanish.
