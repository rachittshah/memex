import type { BenchmarkRun } from './runner.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor',
  'not', 'so', 'yet', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
  'just', 'because', 'if', 'when', 'where', 'how', 'what', 'which',
  'who', 'whom', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it',
  'its', 'they', 'them', 'their',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

export function computePrecision(predicted: string[], groundTruth: string[]): number {
  if (predicted.length === 0) return 0;
  const truthSet = new Set(groundTruth);
  const matches = predicted.filter((t) => truthSet.has(t)).length;
  return matches / predicted.length;
}

export function computeRecall(predicted: string[], groundTruth: string[]): number {
  if (groundTruth.length === 0) return 0;
  const predSet = new Set(predicted);
  const matches = groundTruth.filter((t) => predSet.has(t)).length;
  return matches / groundTruth.length;
}

export function computeF1(predicted: string, groundTruth: string): number {
  const predTokens = tokenize(predicted);
  const truthTokens = tokenize(groundTruth);

  if (predTokens.length === 0 && truthTokens.length === 0) return 1;
  if (predTokens.length === 0 || truthTokens.length === 0) return 0;

  const precision = computePrecision(predTokens, truthTokens);
  const recall = computeRecall(predTokens, truthTokens);

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export interface AggregateMetrics {
  meanF1: number;
  medianF1: number;
  stdDev: number;
  meanTokenEfficiency: number;
  totalMemories: number;
}

export function aggregateMetrics(runs: BenchmarkRun[]): AggregateMetrics {
  if (runs.length === 0) {
    return { meanF1: 0, medianF1: 0, stdDev: 0, meanTokenEfficiency: 0, totalMemories: 0 };
  }

  const f1s = runs.map((r) => r.f1);
  const meanF1 = f1s.reduce((a, b) => a + b, 0) / f1s.length;

  const sorted = [...f1s].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianF1 =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  const variance = f1s.reduce((sum, f) => sum + (f - meanF1) ** 2, 0) / f1s.length;
  const stdDev = Math.sqrt(variance);

  const efficiencies = runs.map((r) => r.tokenEfficiency);
  const meanTokenEfficiency =
    efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length;

  const totalMemories = runs.reduce((sum, r) => sum + r.memoryCount, 0);

  return { meanF1, medianF1, stdDev, meanTokenEfficiency, totalMemories };
}
