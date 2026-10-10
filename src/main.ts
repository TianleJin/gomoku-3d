import { WorkerBot } from './ai/asyncBot';
import { DIFFICULTIES } from './ai/difficulty';
import { colOf, rowOf, SIZE, type Player } from './core/board';
import { Game } from './core/game';
import { BoardScene } from './render/scene';
import { DEFAULT_SETTINGS, Overlay, PLAYER_NAMES, difficultyLabel, type Settings } from './ui/overlay';
import './ui/style.css';

/** Shortest time the bot appears to think, so its reply doesn't feel instant. */
const MIN_BOT_MS = 500;
const SETTINGS_KEY = 'gomoku.settings';

type Controller = 'human' | 'bot';

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    const s = { ...DEFAULT_SETTINGS, ...saved };
    const valid = ['bot', 'friend'].includes(s.opponent) && s.difficulty in DIFFICULTIES && [1, 2, 'random'].includes(s.side);
    return valid ? s : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked; settings just won't persist.
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Board coordinates as players write them: columns A–T (no I), rows 19 at the far edge down to 1. */
function coord(cell: number): string {
  return `${'ABCDEFGHJKLMNOPQRST'[colOf(cell)]}${SIZE - rowOf(cell)}`;
}

const scene = new BoardScene(document.getElementById('scene')!);
const overlay = new Overlay(document.getElementById('ui')!, loadSettings());
const bot = new WorkerBot();
const game = new Game();

let settings = loadSettings();
let controllers: Record<Player, Controller> = { 1: 'human', 2: 'human' };
let current: AbortController | null = null;

overlay.onStart = (s) => {
  settings = s;
  saveSettings(s);
  newGame();
};
overlay.onNewGame = () => newGame();
overlay.onUndo = () => undo();
// The menu sits over the establishing shot; playing brings the camera down to the board.
overlay.onMenuToggle = (open) => scene.setOverview(open);
overlay.onQualityChange = (mode) => scene.setQualityMode(mode);
overlay.setQualityMode(scene.getQualityMode());
overlay.setStatus('Choose a game', null);
overlay.setUndoEnabled(false);
overlay.showMenu(false);

/** Ends any game in progress (cancelling a bot search or a pending click) and starts a new one. */
function newGame(): void {
  game.reset();
  scene.clearBoard();
  if (settings.opponent === 'friend') {
    controllers = { 1: 'human', 2: 'human' };
    overlay.setMatchLabel('Two players · pass and play');
  } else {
    const human: Player = settings.side === 'random' ? (Math.random() < 0.5 ? 1 : 2) : settings.side;
    controllers = human === 1 ? { 1: 'human', 2: 'bot' } : { 1: 'bot', 2: 'human' };
    overlay.setMatchLabel(`You play ${PLAYER_NAMES[human]} · ${difficultyLabel(settings.difficulty)} bot`);
  }
  resume();
}

/**
 * Takes back the last human move (and the bot's reply to it), or the last
 * move in a two-player game, then carries on from there.
 */
function undo(): void {
  const humanMoves = game.history.filter((m) => controllers[m.player] === 'human');
  if (humanMoves.length === 0) return;
  current?.abort();
  for (;;) {
    const move = game.lastMove!;
    game.undo();
    scene.removeStone(move.player);
    if (controllers[move.player] === 'human') break;
  }
  const last = game.lastMove;
  scene.markLast(last?.cell ?? null, last?.player ?? 1);
  overlay.hideResult();
  resume();
}

/** Starts a fresh play loop from the current position, cancelling the previous one. */
function resume(): void {
  current?.abort();
  const session = new AbortController();
  current = session;
  scene.setInput(null);
  overlay.hideResult();
  playLoop(session.signal).catch((err) => {
    if (session.signal.aborted) return;
    console.error(err);
    overlay.setStatus('Something went wrong. Start a new game.', null);
  });
}

/** One loop for every kind of turn: ask the side to move for a cell, then place the stone. */
async function playLoop(signal: AbortSignal): Promise<void> {
  while (game.status === 'playing') {
    const player = game.turn;
    overlay.setUndoEnabled(game.history.some((m) => controllers[m.player] === 'human'));
    const cell = controllers[player] === 'human' ? await humanMove(player, signal) : await botMove(player, signal);
    signal.throwIfAborted();
    game.play(cell);
    await scene.placeStone(cell, player);
    signal.throwIfAborted();
  }
  overlay.setUndoEnabled(game.history.some((m) => controllers[m.player] === 'human'));
  showResult();
}

function humanMove(player: Player, signal: AbortSignal): Promise<number> {
  const vsBot = controllers[1] === 'bot' || controllers[2] === 'bot';
  const last = game.lastMove;
  const prefix = vsBot && last ? `Bot played ${coord(last.cell)} · ` : '';
  overlay.setStatus(`${prefix}${vsBot ? 'Your move' : `${PLAYER_NAMES[player]} to move`}`, player);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      scene.setInput(null);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    scene.onCellSelect = (cell) => {
      if (!game.isLegal(cell)) return;
      signal.removeEventListener('abort', onAbort);
      scene.setInput(null);
      resolve(cell);
    };
    scene.setInput(player, (cell) => game.isLegal(cell));
  });
}

async function botMove(player: Player, signal: AbortSignal): Promise<number> {
  overlay.setStatus('Bot is thinking…', player, true);
  const [cell] = await Promise.all([
    bot.chooseMove(
      game.history.map((m) => m.cell),
      settings.difficulty,
      signal,
    ),
    delay(MIN_BOT_MS, signal),
  ]);
  return cell;
}

function showResult(): void {
  const winner = game.winner;
  const vsBot = controllers[1] === 'bot' || controllers[2] === 'bot';
  const moves = `${game.history.length} moves`;
  if (winner === null) {
    overlay.setStatus('Draw', null);
    overlay.showResult('A draw', `The board is full after ${moves}.`, null);
    return;
  }
  scene.highlightWin(game.winLine);
  const run = game.winLine.length > 5 ? `${game.winLine.length} in a row` : 'Five in a row';
  if (!vsBot) {
    overlay.setStatus(`${PLAYER_NAMES[winner]} wins`, winner);
    overlay.showResult(`${PLAYER_NAMES[winner]} wins!`, `${run} in ${moves}.`, winner);
  } else if (controllers[winner] === 'human') {
    overlay.setStatus('You win', winner);
    overlay.showResult('You win!', `You beat the ${difficultyLabel(settings.difficulty)} bot in ${moves}.`, winner);
  } else {
    overlay.setStatus('The bot wins', winner);
    overlay.showResult('The bot wins', `${run} in ${moves}. Undo, or try again?`, winner);
  }
}
