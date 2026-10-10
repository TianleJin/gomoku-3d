import type { SearchOptions } from './search';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface DifficultyConfig extends SearchOptions {
  /** Probability of playing one of the next few candidate moves instead of the best one. */
  blunderRate: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { maxDepth: 2, timeMs: 200, width: 6, rootWidth: 8, vcfDepth: 0, vcfDefense: false, leafVcf: 0, blunderRate: 0.35 },
  medium: { maxDepth: 6, timeMs: 600, width: 8, rootWidth: 12, vcfDepth: 8, vcfDefense: true, leafVcf: 0, blunderRate: 0.08 },
  hard: { maxDepth: 10, timeMs: 1500, width: 10, rootWidth: 16, vcfDepth: 12, vcfDefense: true, leafVcf: 0, blunderRate: 0 },
  expert: { maxDepth: 16, timeMs: 3000, width: 12, rootWidth: 20, vcfDepth: 16, vcfDefense: true, leafVcf: 3, blunderRate: 0 },
};
