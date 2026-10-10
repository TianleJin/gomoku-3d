import { Board, CELLS, other, type Player } from './board';

export type Status = 'playing' | 'won' | 'draw';

export interface Move {
  cell: number;
  player: Player;
}

/**
 * One game of freestyle Gomoku: 19x19, black moves first, five or more
 * in a row wins (overlines count), a full board is a draw.
 */
export class Game {
  readonly board = new Board();
  readonly history: Move[] = [];
  turn: Player = 1;
  status: Status = 'playing';
  winner: Player | null = null;
  /** Cells of the winning run (5 or more), for highlighting. Empty unless won. */
  winLine: number[] = [];

  get lastMove(): Move | null {
    return this.history[this.history.length - 1] ?? null;
  }

  isLegal(cell: number): boolean {
    return this.status === 'playing' && Number.isInteger(cell) && cell >= 0 && cell < CELLS && this.board.isEmpty(cell);
  }

  /** Plays `cell` for the side to move. Throws if the move is illegal. */
  play(cell: number): void {
    if (!this.isLegal(cell)) throw new Error(`illegal move ${cell}`);
    const player = this.turn;
    this.board.place(cell, player);
    this.history.push({ cell, player });
    const line = this.board.winningLine(cell, player);
    if (line) {
      this.status = 'won';
      this.winner = player;
      this.winLine = line;
    } else if (this.board.isFull()) {
      this.status = 'draw';
    } else {
      this.turn = other(player);
    }
  }

  /** Clears the board for a new game. */
  reset(): void {
    while (this.undo());
  }

  /** Takes back the last move, reopening a finished game. Returns false if there is none. */
  undo(): boolean {
    const move = this.history.pop();
    if (!move) return false;
    this.board.remove(move.cell);
    this.turn = move.player;
    this.status = 'playing';
    this.winner = null;
    this.winLine = [];
    return true;
  }
}
