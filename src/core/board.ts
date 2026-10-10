export const SIZE = 19;
export const CELLS = SIZE * SIZE;
export const WIN_LENGTH = 5;

export type Player = 1 | 2; // 1 = black (moves first), 2 = white
export type Cell = 0 | Player;

/** Line directions as (dRow, dCol): horizontal, vertical, both diagonals. */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export const other = (p: Player): Player => (p === 1 ? 2 : 1);
export const index = (row: number, col: number): number => row * SIZE + col;
export const rowOf = (i: number): number => Math.floor(i / SIZE);
export const colOf = (i: number): number => i % SIZE;
export const inBounds = (row: number, col: number): boolean =>
  row >= 0 && row < SIZE && col >= 0 && col < SIZE;

/** Mutable 19x19 board. Pure data: no turn tracking, no game status. */
export class Board {
  readonly cells = new Uint8Array(CELLS);
  count = 0;

  get(i: number): Cell {
    return this.cells[i] as Cell;
  }

  isEmpty(i: number): boolean {
    return this.cells[i] === 0;
  }

  isFull(): boolean {
    return this.count === CELLS;
  }

  place(i: number, p: Player): void {
    if (i < 0 || i >= CELLS) throw new RangeError(`cell ${i} off board`);
    if (this.cells[i] !== 0) throw new Error(`cell ${i} occupied`);
    this.cells[i] = p;
    this.count++;
  }

  remove(i: number): void {
    if (this.cells[i] === 0) throw new Error(`cell ${i} already empty`);
    this.cells[i] = 0;
    this.count--;
  }

  /**
   * The connected run of colour `p` through `i` in direction (dr, dc), as
   * cell indices ordered along the line. Includes `i` itself.
   */
  lineThrough(i: number, p: Player, dr: number, dc: number): number[] {
    const r0 = rowOf(i);
    const c0 = colOf(i);
    const back: number[] = [];
    for (let r = r0 - dr, c = c0 - dc; inBounds(r, c) && this.cells[index(r, c)] === p; r -= dr, c -= dc) {
      back.push(index(r, c));
    }
    const line = back.reverse();
    line.push(i);
    for (let r = r0 + dr, c = c0 + dc; inBounds(r, c) && this.cells[index(r, c)] === p; r += dr, c += dc) {
      line.push(index(r, c));
    }
    return line;
  }

  /**
   * The winning run (5 or more connected stones) through `i`, or null.
   * `i` must already hold a stone of colour `p`.
   */
  winningLine(i: number, p: Player): number[] | null {
    for (const [dr, dc] of DIRECTIONS) {
      const line = this.lineThrough(i, p, dr, dc);
      if (line.length >= WIN_LENGTH) return line;
    }
    return null;
  }

  /**
   * Empty cells within `radius` of any stone: the only moves worth
   * considering. An empty board yields just the centre point.
   */
  candidateMoves(radius = 2): number[] {
    if (this.count === 0) return [index(SIZE >> 1, SIZE >> 1)];
    const near = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      if (this.cells[i] === 0) continue;
      const r0 = rowOf(i);
      const c0 = colOf(i);
      for (let r = Math.max(0, r0 - radius); r <= Math.min(SIZE - 1, r0 + radius); r++) {
        for (let c = Math.max(0, c0 - radius); c <= Math.min(SIZE - 1, c0 + radius); c++) {
          near[index(r, c)] = 1;
        }
      }
    }
    const moves: number[] = [];
    for (let i = 0; i < CELLS; i++) if (near[i] === 1 && this.cells[i] === 0) moves.push(i);
    return moves;
  }
}
