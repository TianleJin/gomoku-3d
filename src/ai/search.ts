import type { Player } from '../core/board';
import { Engine, WIN, otherPlayer } from './engine';

export interface SearchOptions {
  maxDepth: number;
  timeMs: number;
  /** Moves tried at each inner node, best first by the move-ordering heuristic. */
  width: number;
  /** Moves tried at the root. */
  rootWidth: number;
  /** Longest four-sequence the bot looks for at the root (0 = none). */
  vcfDepth: number;
  /** Rule out root moves that let the opponent win by continuous fours. */
  vcfDefense: boolean;
  /** Look for a short VCF at the leaves of the main search (0 = none). */
  leafVcf: number;
}

export interface SearchResult {
  move: number;
  score: number;
  /** Deepest completed iteration (0 if decided before searching). */
  depth: number;
  nodes: number;
  /** Why the move was chosen, for tests and debugging. */
  reason: 'opening' | 'win' | 'block' | 'vcf' | 'search';
}

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;
const MAX_PLY = 64;
/** Scores this close to WIN are wins at a known distance, adjusted by ply in the table. */
const MATE_BOUND = WIN - 1000;

class Timeout extends Error {}

/** Iterative-deepening alpha-beta over the most promising moves, with a transposition table. */
export class Searcher {
  private ttLo = new Int32Array(TT_SIZE);
  private ttHi = new Int32Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttFlag = new Uint8Array(TT_SIZE);
  private ttScore = new Int32Array(TT_SIZE);
  private ttMove = new Int16Array(TT_SIZE).fill(-1);
  private moveBuf = Array.from({ length: MAX_PLY }, () => new Int16Array(64));
  private scoreBuf = Array.from({ length: MAX_PLY }, () => new Float64Array(64));
  private e!: Engine;
  private opts!: SearchOptions;
  private deadline = 0;
  private nodes = 0;

  search(e: Engine, opts: SearchOptions): SearchResult {
    this.e = e;
    this.opts = opts;
    this.nodes = 0;
    const start = performance.now();
    this.deadline = start + opts.timeMs;
    const me = e.turn;
    const opp = otherPlayer(me);
    const decided = (move: number, reason: SearchResult['reason'], score = 0): SearchResult => ({ move, score, depth: 0, nodes: this.nodes, reason });

    if (e.stones === 0) return decided(e.cells.length >> 1, 'opening');
    const wins = e.fiveCells(me);
    if (wins.length > 0) return decided(wins[0]!, 'win', WIN);
    const blocks = e.fiveCells(opp);
    // Two open fives can't both be blocked; block one anyway.
    if (blocks.length > 0) return decided(blocks[0]!, 'block', blocks.length > 1 ? -WIN : 0);
    if (opts.vcfDepth > 0) {
      const m = e.vcf(me, opts.vcfDepth);
      if (m >= 0) return decided(m, 'vcf', WIN);
    }

    let root = this.rootMoves(me, opp);
    if (root.length === 1) return decided(root[0]!, 'search');

    let best = root[0]!;
    let bestScore = -Infinity;
    let completed = 0;
    for (let depth = 1; depth <= opts.maxDepth; depth++) {
      try {
        const { move, score } = this.searchRoot(root, depth);
        best = move;
        bestScore = score;
        completed = depth;
      } catch (err) {
        if (err instanceof Timeout) break;
        throw err;
      }
      // Best move first next iteration.
      root = [best, ...root.filter((m) => m !== best)];
      if (Math.abs(bestScore) >= MATE_BOUND) break;
      // The next iteration takes several times longer; don't start one we can't finish.
      if (performance.now() - start > opts.timeMs * 0.4) break;
    }
    return { move: best, score: bestScore, depth: completed, nodes: this.nodes, reason: 'search' };
  }

  /**
   * Candidate moves for the root. With VCF defence, moves after which the
   * opponent can force a win with fours are dropped (unless every move loses).
   */
  private rootMoves(me: Player, opp: Player): number[] {
    const e = this.e;
    const buf = new Int16Array(96);
    const sc = new Float64Array(96);
    if (!this.opts.vcfDefense || e.vcf(opp, this.opts.vcfDepth) < 0) {
      const n = e.orderedMoves(me, this.opts.rootWidth, buf, sc);
      return Array.from(buf.subarray(0, n));
    }
    const n = e.orderedMoves(me, 96, buf, sc);
    const safe: number[] = [];
    for (let k = 0; k < n && safe.length < this.opts.rootWidth; k++) {
      const m = buf[k]!;
      e.place(m, me);
      const refuted = e.fiveCells(me).length === 0 && e.vcf(opp, this.opts.vcfDepth) >= 0;
      e.undo();
      if (!refuted) safe.push(m);
    }
    return safe.length > 0 ? safe : Array.from(buf.subarray(0, Math.min(n, this.opts.rootWidth)));
  }

  private searchRoot(moves: number[], depth: number): { move: number; score: number } {
    let alpha = -Infinity;
    let best = moves[0]!;
    for (const m of moves) {
      this.e.play(m);
      const score = -this.negamax(depth - 1, -WIN - 1, -alpha, 1);
      this.e.undo();
      if (score > alpha) {
        alpha = score;
        best = m;
      }
    }
    return { move: best, score: alpha };
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    const e = this.e;
    if ((++this.nodes & 1023) === 0 && performance.now() > this.deadline) throw new Timeout();
    const me = e.turn;
    const opp = otherPlayer(me);
    // The previous move can't have made five: it would have needed a four, which we check first.
    if (e.fours[me]! > 0) return WIN - ply;
    if (e.stones === e.cells.length) return 0;

    let moves: Int16Array;
    let count: number;
    let nextDepth = depth - 1;
    if (e.fours[opp]! > 0) {
      const blocks = e.fiveCells(opp);
      if (blocks.length > 1) return -(WIN - ply - 1);
      // A forced reply: search it without spending depth.
      moves = this.moveBuf[ply]!;
      moves[0] = blocks[0]!;
      count = 1;
      nextDepth = depth;
    } else {
      if (depth <= 0 || ply >= MAX_PLY - 1) {
        if (this.opts.leafVcf > 0 && e.vcf(me, this.opts.leafVcf, 400) >= 0) return WIN - ply - 2 * this.opts.leafVcf;
        return e.evaluate();
      }
      moves = this.moveBuf[ply]!;
      count = e.orderedMoves(me, this.opts.width, moves, this.scoreBuf[ply]!);
    }

    // Transposition table.
    const slot = e.hashLo & (TT_SIZE - 1);
    const hit = this.ttLo[slot] === e.hashLo && this.ttHi[slot] === e.hashHi;
    if (hit) {
      if (this.ttDepth[slot]! >= depth) {
        const s = fromTT(this.ttScore[slot]!, ply);
        const f = this.ttFlag[slot];
        if (f === EXACT) return s;
        if (f === LOWER && s >= beta) return s;
        if (f === UPPER && s <= alpha) return s;
      }
      // Try the stored best move first.
      const tm = this.ttMove[slot]!;
      for (let k = 1; k < count; k++) {
        if (moves[k] === tm) {
          moves.copyWithin(1, 0, k);
          moves[0] = tm;
          break;
        }
      }
    }

    const alpha0 = alpha;
    let best = -Infinity;
    let bestMove = moves[0]!;
    for (let k = 0; k < count; k++) {
      const m = moves[k]!;
      e.play(m);
      const s = -this.negamax(nextDepth, -beta, -alpha, ply + 1);
      e.undo();
      if (s > best) {
        best = s;
        bestMove = m;
        if (s > alpha) alpha = s;
        if (alpha >= beta) break;
      }
    }

    this.ttLo[slot] = e.hashLo;
    this.ttHi[slot] = e.hashHi;
    this.ttDepth[slot] = Math.max(-128, Math.min(127, depth));
    this.ttFlag[slot] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
    this.ttScore[slot] = toTT(best, ply);
    this.ttMove[slot] = bestMove;
    return best;
  }
}

/** Win scores are stored relative to the node, not the root, so they stay valid across transpositions. */
function toTT(s: number, ply: number): number {
  if (s >= MATE_BOUND) return s + ply;
  if (s <= -MATE_BOUND) return s - ply;
  return s;
}

function fromTT(s: number, ply: number): number {
  if (s >= MATE_BOUND) return s - ply;
  if (s <= -MATE_BOUND) return s + ply;
  return s;
}
