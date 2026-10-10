import { describe, expect, it } from 'vitest';
import { CELLS, index } from '../src/core/board';
import { Game } from '../src/core/game';
import { GomokuBot } from '../src/ai/bot';
import { DIFFICULTIES } from '../src/ai/difficulty';
import { Engine } from '../src/ai/engine';
import { Searcher } from '../src/ai/search';

/** Interleaves black and white move lists into one history. */
const interleave = (black: number[], white: number[]): number[] =>
  black.flatMap((b, k) => (white[k] === undefined ? [b] : [b, white[k]!]));

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe('Engine', () => {
  it('place/undo restore score, fours and hash exactly', () => {
    const e = new Engine();
    const rand = rng(7);
    const snapshots: string[] = [];
    const snap = () => JSON.stringify([e.score, e.fours, e.hashLo, e.hashHi, e.evaluate()]);
    for (let k = 0; k < 120; k++) {
      snapshots.push(snap());
      let m: number;
      do m = Math.floor(rand() * CELLS);
      while (e.cells[m] !== 0);
      e.play(m);
    }
    for (let k = 119; k >= 0; k--) {
      e.undo();
      expect(snap()).toBe(snapshots[k]);
    }
  });

  it('counts fours and finds the cells that complete five', () => {
    const e = Engine.fromMoves(interleave([0, 1, 2, 3].map((c) => index(9, 5 + c)), [index(0, 0), index(0, 2), index(0, 4)]));
    expect(e.fours[1]).toBeGreaterThan(0);
    expect(e.fiveCells(1).sort((a, b) => a - b)).toEqual([index(9, 4), index(9, 9)]);
  });

  it('finds a victory by continuous fours', () => {
    // Black (5,8) makes a four on row 5 (white must block at (5,9)) and also a four down column 8.
    const black = [index(5, 5), index(5, 6), index(5, 7), index(6, 8), index(7, 8), index(9, 8)];
    const white = [index(5, 4), index(10, 8), index(0, 0), index(0, 18), index(18, 0)];
    const e = Engine.fromMoves(interleave(black, white));
    expect(e.turn).toBe(2);
    expect(e.vcf(1, 10)).toBe(index(5, 8));
    expect(e.vcf(2, 10)).toBe(-1);
  });
});

describe('Searcher', () => {
  const opts = { ...DIFFICULTIES.hard, timeMs: 1000 };

  it('completes five when it can', () => {
    const e = Engine.fromMoves(interleave([0, 1, 2, 3].map((c) => index(9, 5 + c)), [index(3, 3), index(3, 5), index(3, 7)]));
    expect(e.turn).toBe(2);
    e.play(index(15, 15));
    const r = new Searcher().search(e, opts);
    expect([index(9, 4), index(9, 9)]).toContain(r.move);
    expect(r.reason).toBe('win');
  });

  it('blocks a four', () => {
    const e = Engine.fromMoves(interleave([index(9, 5), index(9, 6), index(9, 7), index(9, 8)], [index(8, 9), index(3, 3), index(3, 5)]));
    expect(e.turn).toBe(2);
    expect(new Searcher().search(e, opts).move).toBe(index(9, 4));
  });

  it('blocks an open three', () => {
    const e = Engine.fromMoves(interleave([index(9, 7), index(9, 8), index(9, 9)], [index(3, 3), index(15, 15)]));
    expect(e.turn).toBe(2);
    const m = new Searcher().search(e, opts).move;
    expect([index(9, 6), index(9, 10), index(9, 5), index(9, 11)]).toContain(m);
  });

  it('turns an open three into an open four', () => {
    const e = Engine.fromMoves(interleave([index(9, 7), index(9, 8), index(9, 9)], [index(3, 3), index(15, 15), index(3, 15)]));
    expect(e.turn).toBe(1);
    const r = new Searcher().search(e, opts);
    expect([index(9, 6), index(9, 10)]).toContain(r.move);
  });
});

/** Plays a whole game between two bots; returns the winner (null for a draw). */
function playMatch(black: GomokuBot, white: GomokuBot): { winner: 1 | 2 | null; moves: number } {
  const g = new Game();
  while (g.status === 'playing') {
    const bot = g.turn === 1 ? black : white;
    g.play(bot.chooseMove(g.history.map((m) => m.cell)));
  }
  return { winner: g.winner, moves: g.history.length };
}

describe('GomokuBot', () => {
  it('beats a random-ish opponent quickly', () => {
    const random = rng(3);
    const dumb = { chooseMove: (moves: readonly number[]) => {
      const e = Engine.fromMoves(moves);
      const buf = new Int16Array(30);
      const n = e.orderedMoves(e.turn, 30, buf, new Float64Array(30));
      return buf[Math.floor(random() * n)]!;
    } } as unknown as GomokuBot;
    const fast = new GomokuBot('medium', rng(1));
    const r = playMatch(fast, dumb);
    expect(r.winner).toBe(1);
  });
});
