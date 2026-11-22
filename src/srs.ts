import type { VocabEntry, VocabItem } from './n5Vocabulary';

export const DAY_MS = 86_400_000;

export type Rating = 'again' | 'good' | 'easy';
export type CardState = VocabItem['state'];

/** Days until the next review after giving `rating` to a card currently at `current` days. */
export function nextInterval(current: number, rating: Rating): number {
  if (rating === 'again') return 1;
  if (rating === 'good') return current <= 1 ? 3 : Math.round(current * 2);
  return current <= 1 ? 7 : Math.round(current * 3);
}

export function stateAfter(rating: Rating, interval: number): CardState {
  if (rating === 'again') return 'learning';
  return interval >= 21 ? 'mastered' : 'learning';
}

export function formatInterval(days: number): string {
  if (days < 7) return days === 1 ? '1 day' : `${days} days`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return w === 1 ? '1 week' : `${w} weeks`;
  }
  const m = Math.round(days / 30);
  return m === 1 ? '1 month' : `${m} months`;
}

export function newItem(entry: VocabEntry): VocabItem {
  return { ...entry, interval: 1, repetitions: 0, dueDate: 0, state: 'new' };
}

export function buildInitialQueue(data: VocabEntry[]): VocabItem[] {
  return data.map(newItem);
}

export function applyRating(item: VocabItem, rating: Rating, now: number): VocabItem {
  const interval = nextInterval(item.interval, rating);
  return {
    ...item,
    interval,
    repetitions: item.repetitions + 1,
    dueDate: now + interval * DAY_MS,
    state: stateAfter(rating, interval),
  };
}

interface SavedProgress {
  id?: unknown;
  kanji?: unknown;
  kana?: unknown;
  interval?: unknown;
  repetitions?: unknown;
  dueDate?: unknown;
  state?: unknown;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function applySaved(entry: VocabEntry, s: SavedProgress): VocabItem {
  const repetitions = Math.max(0, Math.floor(num(s.repetitions, 0)));
  const state: CardState =
    s.state === 'learning' || s.state === 'mastered' ? s.state : 'new';
  // Cards that were never reviewed stay "new" no matter what an old save says.
  if (repetitions === 0) return newItem(entry);
  return {
    ...entry,
    interval: Math.max(1, num(s.interval, 1)),
    repetitions,
    dueDate: num(s.dueDate, 0),
    state: state === 'new' ? 'learning' : state,
  };
}

/**
 * Combine saved progress with the current word list.
 * - same version: progress is matched by id
 * - other version / unknown: matched by (kanji, kana), because old ids can mean other words
 * Text always comes from `data`, so updates to the word list are never hidden by old saves.
 */
export function mergeProgress(
  saved: unknown,
  data: VocabEntry[],
  sameVersion: boolean,
): VocabItem[] {
  if (!Array.isArray(saved) || saved.length === 0) return buildInitialQueue(data);
  const items = saved.filter(
    (s): s is SavedProgress => typeof s === 'object' && s !== null,
  );

  if (sameVersion) {
    const byId = new Map<number, SavedProgress>();
    for (const s of items) if (typeof s.id === 'number') byId.set(s.id, s);
    return data.map((e) => {
      const s = byId.get(e.id);
      return s ? applySaved(e, s) : newItem(e);
    });
  }

  const byWord = new Map<string, SavedProgress[]>();
  for (const s of items) {
    if (typeof s.kanji !== 'string' || typeof s.kana !== 'string') continue;
    const key = `${s.kanji}|${s.kana}`;
    const list = byWord.get(key);
    if (list) list.push(s);
    else byWord.set(key, [s]);
  }
  return data.map((e) => {
    const s = byWord.get(`${e.kanji}|${e.kana}`)?.shift();
    return s ? applySaved(e, s) : newItem(e);
  });
}

export interface Pick {
  index: number | null;
  kind: 'review' | 'new' | 'done';
}

/** Reviews that are due come first (earliest due first), then new cards while allowed. */
export function pickNext(queue: VocabItem[], now: number, newAllowed: number): Pick {
  let best = -1;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    if (q.repetitions > 0 && q.dueDate <= now) {
      if (best === -1 || q.dueDate < queue[best].dueDate) best = i;
    }
  }
  if (best !== -1) return { index: best, kind: 'review' };
  if (newAllowed > 0) {
    const i = queue.findIndex((q) => q.repetitions === 0);
    if (i !== -1) return { index: i, kind: 'new' };
  }
  return { index: null, kind: 'done' };
}

export function nextDueAt(queue: VocabItem[]): number | null {
  let min: number | null = null;
  for (const q of queue) {
    if (q.repetitions > 0 && (min === null || q.dueDate < min)) min = q.dueDate;
  }
  return min;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Consecutive study days ending today (or yesterday, if you haven't studied yet today). */
export function computeStreak(days: string[], now: number): number {
  const set = new Set(days);
  let cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!set.has(dayKey(cursor.getTime()))) cursor = new Date(cursor.getTime() - DAY_MS);
  let streak = 0;
  while (set.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor = new Date(cursor.getTime() - DAY_MS);
    cursor.setHours(12, 0, 0, 0);
  }
  return streak;
}
