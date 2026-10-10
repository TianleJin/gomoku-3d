import { describe, expect, it } from 'vitest';
import { CELLS, SIZE, index } from '../src/core/board';
import { Game } from '../src/core/game';

/** Plays alternating moves: `black` cells for player 1, `white` cells (if any left) for player 2. */
function playOut(game: Game, black: number[], white: number[]): void {
  for (let k = 0; k < black.length; k++) {
    game.play(black[k]!);
    if (white[k] !== undefined) game.play(white[k]!);
  }
}

/** White throwaway moves: every other cell of row 0, so they never connect five. */
const spare = (n: number): number[] => Array.from({ length: n }, (_, k) => index(0, k * 2 + 1));

describe('Game', () => {
  it('starts with black to move on an empty board', () => {
    const g = new Game();
    expect(g.turn).toBe(1);
    expect(g.status).toBe('playing');
    expect(g.board.count).toBe(0);
  });

  it('rejects occupied and off-board moves', () => {
    const g = new Game();
    g.play(index(9, 9));
    expect(g.isLegal(index(9, 9))).toBe(false);
    expect(g.isLegal(-1)).toBe(false);
    expect(g.isLegal(CELLS)).toBe(false);
    expect(() => g.play(index(9, 9))).toThrow();
  });

  const dirs: [string, (k: number) => number][] = [
    ['horizontal', (k) => index(5, 3 + k)],
    ['vertical', (k) => index(3 + k, 5)],
    ['diagonal \\', (k) => index(3 + k, 3 + k)],
    ['diagonal /', (k) => index(3 + k, 10 - k)],
  ];
  for (const [name, at] of dirs) {
    it(`black wins with five in a ${name} line`, () => {
      const g = new Game();
      const black = [0, 1, 2, 3, 4].map(at);
      playOut(g, black, spare(4));
      expect(g.status).toBe('won');
      expect(g.winner).toBe(1);
      expect([...g.winLine].sort((a, b) => a - b)).toEqual([...black].sort((a, b) => a - b));
    });
  }

  it('white can win too', () => {
    const g = new Game();
    const black = [0, 2, 4, 6, 8].map((c) => index(1, c));
    const white = [3, 4, 5, 6, 7].map((c) => index(10, c));
    playOut(g, black, white);
    expect(g.winner).toBe(2);
    expect(g.status).toBe('won');
  });

  it('four in a row is not a win', () => {
    const g = new Game();
    playOut(g, [0, 1, 2, 3].map((c) => index(5, c)), spare(3));
    expect(g.status).toBe('playing');
  });

  it('an overline (six) wins and the whole run is the win line', () => {
    const g = new Game();
    // Black leaves a gap at column 3, then closes it to make six.
    const black = [0, 1, 2, 4, 5].map((c) => index(5, c));
    playOut(g, black, spare(5));
    expect(g.status).toBe('playing');
    g.play(index(5, 3));
    expect(g.status).toBe('won');
    expect(g.winLine).toHaveLength(6);
  });

  it('a line broken by an opponent stone does not count', () => {
    const g = new Game();
    const black = [0, 1, 3, 4, 5].map((c) => index(5, c));
    playOut(g, black, [index(5, 2), ...spare(3)]);
    expect(g.status).toBe('playing');
  });

  it('wins at the board edge and corner', () => {
    const g = new Game();
    const black = [14, 15, 16, 17, 18].map((c) => index(SIZE - 1, c));
    playOut(g, black, spare(4));
    expect(g.winner).toBe(1);
    const h = new Game();
    playOut(h, [0, 1, 2, 3, 4].map((k) => index(k, k)), spare(4));
    expect(h.winner).toBe(1);
  });

  it('declares a draw when the last cell fills the board with no five', () => {
    const g = new Game();
    // Colour by ((row >> 1) + col) parity: no run longer than 2 in any direction.
    const colour = (i: number) => ((((Math.floor(i / SIZE) >> 1) + (i % SIZE)) & 1) === 0 ? 1 : 2);
    for (let i = 0; i < CELLS - 1; i++) g.board.place(i, colour(i));
    g.turn = colour(CELLS - 1);
    g.play(CELLS - 1);
    expect(g.status).toBe('draw');
    expect(g.winner).toBeNull();
  });

  it('undo restores turn, board and status, and reopens a won game', () => {
    const g = new Game();
    playOut(g, [0, 1, 2, 3, 4].map((c) => index(5, c)), spare(4));
    expect(g.status).toBe('won');
    expect(g.undo()).toBe(true);
    expect(g.status).toBe('playing');
    expect(g.winner).toBeNull();
    expect(g.winLine).toEqual([]);
    expect(g.turn).toBe(1);
    expect(g.board.isEmpty(index(5, 4))).toBe(true);
    expect(new Game().undo()).toBe(false);
  });

  it('refuses moves after the game is over', () => {
    const g = new Game();
    playOut(g, [0, 1, 2, 3, 4].map((c) => index(5, c)), spare(4));
    expect(() => g.play(index(10, 10))).toThrow();
  });
});

describe('Board.candidateMoves', () => {
  it('offers only the centre on an empty board', () => {
    expect(new Game().board.candidateMoves()).toEqual([index(9, 9)]);
  });

  it('offers empty cells within two squares of a stone', () => {
    const g = new Game();
    g.play(index(9, 9));
    const moves = g.board.candidateMoves(2);
    expect(moves).toHaveLength(24);
    expect(moves).not.toContain(index(9, 9));
    expect(moves).toContain(index(7, 7));
    expect(moves).not.toContain(index(6, 9));
  });

  it('clips to the board near corners', () => {
    const g = new Game();
    g.play(index(0, 0));
    expect(g.board.candidateMoves(2)).toHaveLength(8);
  });
});
