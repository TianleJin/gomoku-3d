import type { BotRequest, BotResponse } from './bot.worker';
import type { Difficulty } from './difficulty';

interface Pending {
  resolve: (move: number) => void;
  reject: (reason: unknown) => void;
}

/**
 * Runs GomokuBot in a Web Worker so the page stays responsive while it thinks.
 * A search cannot be interrupted, so aborting replaces the worker.
 */
export class WorkerBot {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  chooseMove(moves: readonly number[], difficulty: Difficulty, signal?: AbortSignal): Promise<number> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const id = this.nextId++;
      const onAbort = () => {
        this.pending.delete(id);
        this.restart();
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (move) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(move);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      });
      const request: BotRequest = { id, moves: [...moves], difficulty };
      this.getWorker().postMessage(request);
    });
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<BotResponse>) => {
      const p = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      p?.resolve(e.data.move);
    };
    worker.onerror = (e) => {
      const err = new Error(`Bot worker failed: ${e.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.restart();
    };
    this.worker = worker;
    return worker;
  }

  /** Kills the worker (and any search in progress); the next request starts a fresh one. */
  private restart(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
