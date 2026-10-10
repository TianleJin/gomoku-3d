import { DIFFICULTIES, type Difficulty } from './difficulty';
import { Engine, otherPlayer } from './engine';
import { Searcher } from './search';

/** Alpha-beta bot whose strength is set by search depth, width, time, threat search and blunder rate. */
export class GomokuBot {
  private searcher = new Searcher();

  constructor(
    private difficulty: Difficulty,
    private random: () => number = Math.random,
  ) {}

  /** Picks a cell for the side to move after `moves` (cell indices, black first). */
  chooseMove(moves: readonly number[]): number {
    const cfg = DIFFICULTIES[this.difficulty];
    const e = Engine.fromMoves(moves);
    if (e.stones === e.cells.length) throw new Error('No legal moves');

    // A "blunder" is a lesser candidate move, but never one that skips an immediate win or block.
    if (cfg.blunderRate > 0 && this.random() < cfg.blunderRate && !this.hasTacticalMove(e)) {
      const buf = new Int16Array(4);
      const n = e.orderedMoves(e.turn, 4, buf, new Float64Array(4));
      return buf[Math.floor(this.random() * n)]!;
    }
    return this.searcher.search(e, cfg).move;
  }

  /** True if the mover can win now or must block a five. */
  private hasTacticalMove(e: Engine): boolean {
    return e.fours[e.turn]! > 0 || e.fours[otherPlayer(e.turn)]! > 0;
  }
}
