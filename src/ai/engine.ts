import { CELLS, DIRECTIONS, SIZE, inBounds, index, type Player } from '../core/board';

/*
 * The bot's view of the board. Everything is scored through "windows": every
 * run of five cells in a line (1020 of them on 19x19). A window that holds
 * only one colour is a potential five for that colour, worth more the more
 * stones it already has. Placing or removing a stone touches at most 20
 * windows, so the evaluation, the four counts and the hash are all kept
 * incrementally.
 */

/** Cell indices of every window, five per window. */
const WINDOW_CELLS: Int16Array = (() => {
  const out: number[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (const [dr, dc] of DIRECTIONS) {
        if (!inBounds(r + 4 * dr, c + 4 * dc)) continue;
        for (let k = 0; k < 5; k++) out.push(index(r + k * dr, c + k * dc));
      }
    }
  }
  return Int16Array.from(out);
})();
export const WINDOWS = WINDOW_CELLS.length / 5;

/** For each cell, the windows that contain it (at most 20), packed 20 per cell. */
const MAX_PER_CELL = 20;
const CELL_WINDOWS = new Int16Array(CELLS * MAX_PER_CELL);
const CELL_WINDOW_COUNT = new Uint8Array(CELLS);
for (let w = 0; w < WINDOWS; w++) {
  for (let k = 0; k < 5; k++) {
    const cell = WINDOW_CELLS[w * 5 + k]!;
    CELL_WINDOWS[cell * MAX_PER_CELL + CELL_WINDOW_COUNT[cell]!++] = w;
  }
}

/** Cells within two steps (Chebyshev distance) of each cell, excluding itself. */
const NEAR_RADIUS = 2;
const NEIGHBOURS: Int16Array[] = Array.from({ length: CELLS }, (_, i) => {
  const r0 = Math.floor(i / SIZE);
  const c0 = i % SIZE;
  const out: number[] = [];
  for (let r = r0 - NEAR_RADIUS; r <= r0 + NEAR_RADIUS; r++) {
    for (let c = c0 - NEAR_RADIUS; c <= c0 + NEAR_RADIUS; c++) {
      if ((r !== r0 || c !== c0) && inBounds(r, c)) out.push(index(r, c));
    }
  }
  return Int16Array.from(out);
});

/** Deterministic 32-bit Zobrist keys, two halves per (cell, player). */
const ZOBRIST: Int32Array = (() => {
  let s = 0x9e3779b9;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s | 0;
  };
  const z = new Int32Array(CELLS * 4);
  for (let i = 0; i < z.length; i++) z[i] = next();
  return z;
})();

/** Evaluation value of an unblocked window by the number of stones in it. Five ends the game. */
const WINDOW_VALUE = [0, 1, 10, 100, 1000, 0];

/** Move-ordering value of extending one's own window holding `n` stones (4 means it makes five). */
const ATTACK = [1, 12, 120, 1500, 1_000_000];
/** Move-ordering value of blocking an opponent window holding `n` stones. */
const DEFEND = [0, 8, 90, 1200, 500_000];

/** Score for a win; a win `k` plies away scores WIN - k so faster wins rank higher. */
export const WIN = 100_000_000;

export const otherPlayer = (p: Player): Player => (p === 1 ? 2 : 1);

export class Engine {
  readonly cells = new Int8Array(CELLS);
  /** Stone counts per window, indexed by player (index 0 unused). */
  private readonly count: [Int8Array, Int8Array, Int8Array] = [new Int8Array(0), new Int8Array(WINDOWS), new Int8Array(WINDOWS)];
  /** Sum of WINDOW_VALUE over each player's unblocked windows. */
  readonly score = [0, 0, 0];
  /** Number of unblocked windows holding four stones, per player: each is a threat to make five. */
  readonly fours = [0, 0, 0];
  /** How many stones lie within NEAR_RADIUS of each cell: moves far from every stone are never searched. */
  private readonly near = new Uint8Array(CELLS);
  private readonly history: number[] = [];
  private readonly stamp = new Int32Array(CELLS);
  private stampValue = 0;
  hashLo = 0;
  hashHi = 0;
  /** Nodes visited by VCF since the counter was last reset; bounds the threat search. */
  vcfNodes = 0;

  static fromMoves(moves: readonly number[]): Engine {
    const e = new Engine();
    for (const m of moves) e.play(m);
    return e;
  }

  get stones(): number {
    return this.history.length;
  }

  /** Black (1) moves on even counts; there are no passes in Gomoku. */
  get turn(): Player {
    return (this.history.length & 1) === 0 ? 1 : 2;
  }

  get lastMove(): number {
    return this.history[this.history.length - 1] ?? -1;
  }

  /** Plays for the side to move. */
  play(i: number): void {
    this.place(i, this.turn);
  }

  undo(): void {
    const i = this.history[this.history.length - 1];
    if (i === undefined) throw new Error('nothing to undo');
    this.remove(i);
  }

  /** Puts a stone of `p` on empty cell `i`. Callers keep colours alternating. */
  place(i: number, p: Player): void {
    const o = otherPlayer(p);
    const mine = this.count[p];
    const theirs = this.count[o];
    const base = i * MAX_PER_CELL;
    for (let k = 0, n = CELL_WINDOW_COUNT[i]!; k < n; k++) {
      const w = CELL_WINDOWS[base + k]!;
      const a = mine[w]!;
      const b = theirs[w]!;
      if (b === 0) {
        this.score[p]! += WINDOW_VALUE[a + 1]! - WINDOW_VALUE[a]!;
        if (a === 3) this.fours[p]!++;
        else if (a === 4) this.fours[p]!--;
      } else if (a === 0) {
        // This window was the opponent's; it is dead now.
        this.score[o]! -= WINDOW_VALUE[b]!;
        if (b === 4) this.fours[o]!--;
      }
      mine[w] = a + 1;
    }
    this.cells[i] = p;
    this.history.push(i);
    for (const j of NEIGHBOURS[i]!) this.near[j]!++;
    this.hashLo ^= ZOBRIST[i * 4 + p * 2 - 2]!;
    this.hashHi ^= ZOBRIST[i * 4 + p * 2 - 1]!;
  }

  /** Exactly reverses `place` for the most recent stone. */
  private remove(i: number): void {
    const p = this.cells[i] as Player;
    const o = otherPlayer(p);
    const mine = this.count[p];
    const theirs = this.count[o];
    const base = i * MAX_PER_CELL;
    for (let k = 0, n = CELL_WINDOW_COUNT[i]!; k < n; k++) {
      const w = CELL_WINDOWS[base + k]!;
      const a = mine[w]! - 1;
      const b = theirs[w]!;
      if (b === 0) {
        this.score[p]! -= WINDOW_VALUE[a + 1]! - WINDOW_VALUE[a]!;
        if (a === 3) this.fours[p]!--;
        else if (a === 4) this.fours[p]!++;
      } else if (a === 0) {
        this.score[o]! += WINDOW_VALUE[b]!;
        if (b === 4) this.fours[o]!++;
      }
      mine[w] = a;
    }
    this.cells[i] = 0;
    this.history.pop();
    for (const j of NEIGHBOURS[i]!) this.near[j]!--;
    this.hashLo ^= ZOBRIST[i * 4 + p * 2 - 2]!;
    this.hashHi ^= ZOBRIST[i * 4 + p * 2 - 1]!;
  }

  /** True if `p` playing `i` completes five or more. */
  makesFive(i: number, p: Player): boolean {
    const mine = this.count[p];
    const theirs = this.count[otherPlayer(p)];
    const base = i * MAX_PER_CELL;
    for (let k = 0, n = CELL_WINDOW_COUNT[i]!; k < n; k++) {
      const w = CELL_WINDOWS[base + k]!;
      if (mine[w] === 4 && theirs[w] === 0) return true;
    }
    return false;
  }

  /**
   * The cells where `p` would complete five: the empty cell of each of p's
   * four-stone windows, without duplicates. Two or more distinct cells cannot
   * both be blocked.
   */
  fiveCells(p: Player): number[] {
    if (this.fours[p] === 0) return [];
    const mine = this.count[p];
    const theirs = this.count[otherPlayer(p)];
    const stamp = ++this.stampValue;
    const out: number[] = [];
    for (let w = 0; w < WINDOWS; w++) {
      if (mine[w] !== 4 || theirs[w] !== 0) continue;
      for (let k = 0; k < 5; k++) {
        const c = WINDOW_CELLS[w * 5 + k]!;
        if (this.cells[c] === 0 && this.stamp[c] !== stamp) {
          this.stamp[c] = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Static evaluation for the side to move, assuming neither side has a
   * four on the board (search resolves those first). The mover's threats
   * count for more because it is their turn to use them.
   */
  evaluate(): number {
    const me = this.turn;
    return this.score[me]! * 5 - this.score[otherPlayer(me)]! * 4;
  }

  /** How good `i` is as a move for `p`: what it builds plus what it blocks. Used to order moves. */
  moveScore(i: number, p: Player): number {
    const mine = this.count[p];
    const theirs = this.count[otherPlayer(p)];
    const base = i * MAX_PER_CELL;
    let s = 0;
    for (let k = 0, n = CELL_WINDOW_COUNT[i]!; k < n; k++) {
      const w = CELL_WINDOWS[base + k]!;
      const a = mine[w]!;
      const b = theirs[w]!;
      if (b === 0) s += ATTACK[a]!;
      else if (a === 0) s += DEFEND[b]!;
    }
    return s;
  }

  /**
   * Up to `limit` empty cells near existing stones, best first by
   * `moveScore` for `p`, written into `moves`; returns how many. An empty
   * board yields the centre.
   */
  orderedMoves(p: Player, limit: number, moves: Int16Array, scores: Float64Array): number {
    if (this.history.length === 0) {
      moves[0] = index(SIZE >> 1, SIZE >> 1);
      return 1;
    }
    let n = 0;
    for (let i = 0; i < CELLS; i++) {
      if (this.cells[i] !== 0 || this.near[i] === 0) continue;
      const s = this.moveScore(i, p);
      // Insertion into the sorted top `limit`.
      if (n < limit) n++;
      else if (s <= scores[n - 1]!) continue;
      let j = n - 1;
      while (j > 0 && scores[j - 1]! < s) {
        scores[j] = scores[j - 1]!;
        moves[j] = moves[j - 1]!;
        j--;
      }
      scores[j] = s;
      moves[j] = i;
    }
    return n;
  }

  /** Empty cells where `p` would make a four (a window with three of p's stones and no opponent's). */
  private fourMakers(p: Player): number[] {
    const mine = this.count[p];
    const theirs = this.count[otherPlayer(p)];
    const stamp = ++this.stampValue;
    const out: number[] = [];
    for (let w = 0; w < WINDOWS; w++) {
      if (mine[w] !== 3 || theirs[w] !== 0) continue;
      for (let k = 0; k < 5; k++) {
        const c = WINDOW_CELLS[w * 5 + k]!;
        if (this.cells[c] === 0 && this.stamp[c] !== stamp) {
          this.stamp[c] = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Victory by continuous fours: can `att` win by making a four on every
   * move, so the opponent only ever has one reply? Returns the first move of
   * such a sequence, or -1. Ignores whose turn it is (it asks "if att moved
   * now"). Gives up (returns -1) after `maxNodes` nodes.
   */
  vcf(att: Player, maxDepth: number, maxNodes = 20_000): number {
    if (this.fours[att]! > 0) return this.fiveCells(att)[0]!;
    this.vcfNodes = 0;
    const def = otherPlayer(att);
    if (this.fours[def]! > 0) return -1;
    for (const m of this.sortedFourMakers(att)) {
      if (this.vcfMove(att, def, m, maxDepth, maxNodes)) return m;
    }
    return -1;
  }

  private sortedFourMakers(att: Player): number[] {
    const makers = this.fourMakers(att);
    const s = makers.map((c) => this.moveScore(c, att));
    return makers.map((c, k) => [c, s[k]!] as const).sort((x, y) => y[1] - x[1]).map(([c]) => c);
  }

  /** Plays four-maker `m` for `att`, the forced block, and recurses. */
  private vcfMove(att: Player, def: Player, m: number, depth: number, maxNodes: number): boolean {
    if (++this.vcfNodes > maxNodes) return false;
    this.place(m, att);
    const fives = this.fiveCells(att);
    let won: boolean;
    if (fives.length >= 2) won = true; // Two threats, one reply.
    else if (fives.length === 0 || depth <= 1) won = false;
    else {
      this.place(fives[0]!, def);
      // If the block makes a four for the defender, the attacker would have to answer it; give up on this line.
      won = this.fours[def] === 0 && this.vcfRest(att, def, depth - 1, maxNodes);
      this.remove(fives[0]!);
    }
    this.remove(m);
    return won;
  }

  private vcfRest(att: Player, def: Player, depth: number, maxNodes: number): boolean {
    for (const m of this.sortedFourMakers(att)) {
      if (this.vcfNodes > maxNodes) return false;
      if (this.vcfMove(att, def, m, depth, maxNodes)) return true;
    }
    return false;
  }
}
