import { GomokuBot } from './bot';
import type { Difficulty } from './difficulty';

export interface BotRequest {
  id: number;
  /** Cells played so far, black first. */
  moves: number[];
  difficulty: Difficulty;
}

export interface BotResponse {
  id: number;
  move: number;
}

// One bot per level, so each keeps its transposition table between moves.
const bots = new Map<Difficulty, GomokuBot>();

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, moves, difficulty } = e.data;
  let bot = bots.get(difficulty);
  if (!bot) {
    bot = new GomokuBot(difficulty);
    bots.set(difficulty, bot);
  }
  const response: BotResponse = { id, move: bot.chooseMove(moves) };
  self.postMessage(response);
};
