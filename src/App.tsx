import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { useMemo, useState, type ChangeEvent } from 'react';
import { N5_VOCAB_DATA, VOCAB_VERSION, type VocabItem } from './n5Vocabulary';
import {
  applyRating,
  computeStreak,
  dayKey,
  formatInterval,
  mergeProgress,
  nextDueAt,
  nextInterval,
  pickNext,
  type Rating,
} from './srs';
import { FuriganaText } from './furigana';
import {
  BookOpen, Award, RotateCcw, Flame, Clock, ArrowRight, Settings, Sparkles, Download, Upload, Search,
} from 'lucide-react';

const KEY_PROGRESS = 'n5_vocab_progress';
const KEY_VERSION = 'n5_vocab_version';
const KEY_TARGET = 'n5_target_days';
const KEY_DAILY = 'n5_daily';
const KEY_DAYS = 'n5_study_days';
const DICTIONARY_LIMIT = 200;

type Tab = 'study' | 'dashboard' | 'settings' | 'dictionary';

interface Daily {
  date: string;
  reviewed: number;
  newIntroduced: number;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.error('Could not save to localStorage', e);
  }
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadQueue(): VocabItem[] {
  const saved = safeParse(safeGet(KEY_PROGRESS));
  const sameVersion = safeGet(KEY_VERSION) === VOCAB_VERSION;
  const queue = mergeProgress(saved, N5_VOCAB_DATA, sameVersion);
  safeSet(KEY_PROGRESS, JSON.stringify(queue));
  safeSet(KEY_VERSION, VOCAB_VERSION);
  return queue;
}

function loadDaily(): Daily {
  const d = safeParse(safeGet(KEY_DAILY)) as Partial<Daily> | null;
  if (d && typeof d.date === 'string' && typeof d.reviewed === 'number' && typeof d.newIntroduced === 'number') {
    return { date: d.date, reviewed: d.reviewed, newIntroduced: d.newIntroduced };
  }
  return { date: '', reviewed: 0, newIntroduced: 0 };
}

function loadStudyDays(): string[] {
  const d = safeParse(safeGet(KEY_DAYS));
  return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [];
}

function loadTargetDays(): number {
  const n = parseInt(safeGet(KEY_TARGET) ?? '', 10);
  return Number.isFinite(n) && n >= 15 && n <= 180 ? n : 45;
}

const tabClass = (active: boolean) =>
  `min-w-0 w-full px-1.5 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-semibold transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
    active
      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-600/40 ring-1 ring-white/20'
      : 'text-slate-400 hover:text-white hover:bg-white/[0.02]'
  }`;

export default function App() {
  const [targetDays, setTargetDays] = useState<number>(loadTargetDays);
  const [queue, setQueue] = useState<VocabItem[]>(loadQueue);
  const [daily, setDaily] = useState<Daily>(loadDaily);
  const [studyDays, setStudyDays] = useState<string[]>(loadStudyDays);
  const [showAnswer, setShowAnswer] = useState(false);
  const [studyMore, setStudyMore] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('study');
  const [search, setSearch] = useState('');

  const totalWords = N5_VOCAB_DATA.length;
  const dailyTargetQuota = Math.ceil(totalWords / targetDays);
  const today = dayKey(Date.now());
  const dailyToday: Daily = daily.date === today ? daily : { date: today, reviewed: 0, newIntroduced: 0 };
  const newAllowed = studyMore ? Infinity : Math.max(0, dailyTargetQuota - dailyToday.newIntroduced);

  const pick = useMemo(() => pickNext(queue, Date.now(), newAllowed), [queue, newAllowed]);
  const activeCard: VocabItem | null = pick.index === null ? null : queue[pick.index];
  const streak = computeStreak(studyDays, Date.now());

  const persistQueue = (next: VocabItem[]) => {
    setQueue(next);
    safeSet(KEY_PROGRESS, JSON.stringify(next));
    safeSet(KEY_VERSION, VOCAB_VERSION);
  };

  const handleRating = (rating: Rating) => {
    if (pick.index === null) return;
    const now = Date.now();
    const item = queue[pick.index];
    const wasNew = item.repetitions === 0;

    persistQueue(queue.map((q, i) => (i === pick.index ? applyRating(item, rating, now) : q)));

    const nextDaily: Daily = {
      date: today,
      reviewed: dailyToday.reviewed + 1,
      newIntroduced: dailyToday.newIntroduced + (wasNew ? 1 : 0),
    };
    setDaily(nextDaily);
    safeSet(KEY_DAILY, JSON.stringify(nextDaily));

    if (!studyDays.includes(today)) {
      const days = [...studyDays, today].slice(-400);
      setStudyDays(days);
      safeSet(KEY_DAYS, JSON.stringify(days));
    }
    setShowAnswer(false);
  };

  const handleExportBackup = async () => {
  const backup = {
    version: VOCAB_VERSION,
    exportedAt: new Date().toISOString(),
    studyDays,
    progress: queue
      .filter((q) => q.repetitions > 0)
      .map(({ id, kanji, kana, interval, repetitions, dueDate, state }) => ({
        id, kanji, kana, interval, repetitions, dueDate, state,
      })),
  };

  const fileName = `bullet_jlpt_backup_${new Date().toISOString().slice(0, 10)}.json`;
  const jsonText = JSON.stringify(backup, null, 2);

  if (Capacitor.isNativePlatform()) {
    try {
      const written = await Filesystem.writeFile({
        path: fileName,
        data: jsonText,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: 'Bullet JLPT Backup',
        files: [written.uri],
        dialogTitle: 'Save or share JSON backup',
      });
      return;
    } catch (err) {
      console.error('Native share/export failed', err);
      return;
    }
  }

  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

  const handleImportBackup = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        let progress: unknown = null;
        let sameVersion = false;
        let days: string[] = [];
        if (Array.isArray(parsed)) {
          progress = parsed;
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.progress)) {
          progress = parsed.progress;
          sameVersion = parsed.version === VOCAB_VERSION;
          if (Array.isArray(parsed.studyDays)) {
            days = parsed.studyDays.filter((x: unknown): x is string => typeof x === 'string');
          }
        }
        if (!progress) {
          alert('Invalid backup file format.');
          return;
        }
        persistQueue(mergeProgress(progress, N5_VOCAB_DATA, sameVersion));
        if (days.length > 0) {
          const merged = Array.from(new Set([...studyDays, ...days])).sort().slice(-400);
          setStudyDays(merged);
          safeSet(KEY_DAYS, JSON.stringify(merged));
        }
        setShowAnswer(false);
        alert('Backup imported successfully!');
      } catch {
        alert('Failed to read the backup file.');
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleReset = () => {
    if (!window.confirm('Reset all learning progress?')) return;
    [KEY_PROGRESS, KEY_VERSION, KEY_DAILY, KEY_DAYS].forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    });
    window.location.reload();
  };

  const masteredCount = queue.filter((i) => i.state === 'mastered').length;
  const learningCount = queue.filter((i) => i.state === 'learning').length;
  const newCount = queue.filter((i) => i.state === 'new').length;

  const query = search.trim().toLowerCase();
  const dictionaryMatches = useMemo(() => {
    if (!query) return N5_VOCAB_DATA;
    return N5_VOCAB_DATA.filter(
      (w) =>
        String(w.id) === query ||
        w.kanji.toLowerCase().includes(query) ||
        w.kana.toLowerCase().includes(query) ||
        w.meaning.toLowerCase().includes(query),
    );
  }, [query]);

  const nextDue = nextDueAt(queue);
  const newLeft = queue.filter((q) => q.repetitions === 0).length;

  return (
    <div className="min-h-dvh w-full max-w-full text-slate-100 flex flex-col font-sans relative overflow-x-hidden bg-[#070913]">
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-[40%] left-[30%] w-[400px] h-[400px] bg-cyan-600/15 rounded-full blur-[120px] pointer-events-none"></div>

      <header className="w-full max-w-full min-w-0 border-b border-white/10 bg-white/[0.03] backdrop-blur-xl sticky top-0 z-50 px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row gap-2.5 sm:gap-3 sm:items-center sm:justify-between shadow-2xl">
        <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2 sm:p-2.5 rounded-2xl text-white shadow-lg shadow-indigo-500/30 flex items-center justify-center font-bold text-base sm:text-lg ring-1 ring-white/20 shrink-0">
            ⚡
          </div>
          <div className="min-w-0">
            <h1 className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent truncate">
              Bullet JLPT
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">JLPT N5 Edition</p>
          </div>
        </div>

        <nav
          aria-label="Primary sections"
          className="w-full sm:w-auto max-w-full min-w-0 grid grid-cols-4 gap-1 bg-white/[0.04] p-1 sm:p-1.5 rounded-2xl border border-white/10 shadow-inner"
        >
          <button onClick={() => setActiveTab('study')} className={tabClass(activeTab === 'study')}>
            <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Study</span>
          </button>
          <button onClick={() => setActiveTab('dictionary')} className={tabClass(activeTab === 'dictionary')}>
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Words</span>
          </button>
          <button onClick={() => setActiveTab('dashboard')} className={tabClass(activeTab === 'dashboard')}>
            <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Progress</span>
          </button>
          <button onClick={() => setActiveTab('settings')} className={tabClass(activeTab === 'settings')}>
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Settings</span>
          </button>
        </nav>
      </header>

      <main className="flex-1 max-w-3xl w-full min-w-0 mx-auto px-3 sm:px-6 pt-3 pb-5 sm:py-6 flex flex-col justify-start relative z-10">
        {activeTab === 'study' && (
          <div className="space-y-4 sm:space-y-6 w-full min-w-0">
            <div className="grid grid-cols-3 gap-2 sm:gap-4 w-full min-w-0">
              <div className="min-w-0 bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl sm:rounded-3xl p-2.5 sm:p-4 flex items-center gap-2 sm:gap-3.5 shadow-xl">
                <div className="bg-amber-500/10 p-2 sm:p-3 rounded-xl sm:rounded-2xl text-amber-400 ring-1 ring-amber-500/20 shrink-0">
                  <Flame className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] sm:text-xs font-medium text-slate-400 truncate">Streak</div>
                  <div className="text-sm sm:text-lg font-bold text-slate-100 whitespace-nowrap">
                    {streak} {streak === 1 ? 'Day' : 'Days'}
                  </div>
                </div>
              </div>

              <div className="min-w-0 bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl sm:rounded-3xl p-2.5 sm:p-4 flex items-center gap-2 sm:gap-3.5 shadow-xl">
                <div className="bg-indigo-500/10 p-2 sm:p-3 rounded-xl sm:rounded-2xl text-indigo-400 ring-1 ring-indigo-500/20 shrink-0">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] sm:text-xs font-medium text-slate-400 truncate">Today</div>
                  <div className="text-sm sm:text-lg font-bold text-slate-100 whitespace-nowrap tabular-nums">
                    {dailyToday.reviewed}/{dailyTargetQuota}
                  </div>
                </div>
              </div>

              <div className="min-w-0 bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl sm:rounded-3xl p-2.5 sm:p-4 flex items-center gap-2 sm:gap-3.5 shadow-xl">
                <div className="bg-emerald-500/10 p-2 sm:p-3 rounded-xl sm:rounded-2xl text-emerald-400 ring-1 ring-emerald-500/20 shrink-0">
                  <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] sm:text-xs font-medium text-slate-400 truncate">Target</div>
                  <div className="text-sm sm:text-lg font-bold text-slate-100 whitespace-nowrap">
                    {targetDays} Days
                  </div>
                </div>
              </div>
            </div>

            {activeCard ? (
              <div className="bg-white/[0.04] backdrop-blur-2xl border border-white/10 rounded-[28px] sm:rounded-[35px] p-5 sm:p-12 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] relative overflow-hidden flex flex-col items-center min-h-[380px] sm:min-h-[420px] justify-between group">
                <div className="w-full flex justify-between items-center gap-2 text-xs text-slate-400 font-medium">
                  <span className="bg-white/[0.06] px-3 py-1.5 rounded-full border border-white/10 shadow-inner whitespace-nowrap">
                    Word {activeCard.id} of {totalWords}
                  </span>
                  <span className={`px-3 py-1 rounded-full font-semibold uppercase tracking-wider text-[10px] ring-1 whitespace-nowrap ${
                    activeCard.state === 'mastered' ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20' :
                    activeCard.state === 'learning' ? 'bg-amber-500/10 text-amber-400 ring-amber-500/20' :
                    'bg-blue-500/10 text-blue-400 ring-blue-500/20'
                  }`}>
                    {pick.kind === 'review' ? 'review' : activeCard.state}
                  </span>
                </div>

                <div className="my-auto text-center space-y-3 sm:space-y-4 py-5 sm:py-6 w-full min-w-0">
                  <h2 className="text-4xl sm:text-7xl font-black tracking-tight text-white drop-shadow-md break-words">
                    {activeCard.kanji}
                  </h2>
                  {activeCard.kana !== activeCard.kanji && (
                    <div className="text-xl sm:text-2xl text-indigo-300 font-semibold tracking-wide">{activeCard.kana}</div>
                  )}

                  {showAnswer ? (
                    <div className="mt-5 sm:mt-6 pt-5 sm:pt-6 border-t border-white/10 space-y-3 sm:space-y-4 animate-fadeIn">
                      <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 drop-shadow">{activeCard.meaning}</div>
                      {activeCard.example && (
                        <div className="bg-white/[0.03] backdrop-blur p-4 sm:p-5 rounded-2xl border border-white/10 text-sm space-y-1.5 shadow-inner">
                          <div className="text-slate-200 font-medium text-lg sm:text-xl tracking-wide">
                            <FuriganaText text={activeCard.example} />
                          </div>
                          <div className="text-slate-400 italic text-xs">{activeCard.exampleMeaning}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-slate-400/80 text-sm pt-3 sm:pt-4 font-medium tracking-wide">Click below to reveal meaning</div>
                  )}
                </div>

                <div className="w-full pt-3 sm:pt-4">
                  {!showAnswer ? (
                    <button
                      onClick={() => setShowAnswer(true)}
                      className="w-full py-3.5 sm:py-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-2xl shadow-[0_0_25px_rgba(99,102,241,0.4)] transition-all flex items-center justify-center space-x-2 text-sm sm:text-base ring-1 ring-white/20 active:scale-[0.99]"
                    >
                      <span>Show Answer</span>
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      <button
                        onClick={() => handleRating('again')}
                        className="py-3.5 sm:py-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold rounded-2xl transition-all text-xs sm:text-sm flex flex-col items-center shadow-lg shadow-rose-500/5 active:scale-95"
                      >
                        <span>Again</span>
                        <span className="text-[10px] text-rose-400/70 font-normal mt-0.5">{formatInterval(nextInterval(activeCard.interval, 'again'))}</span>
                      </button>
                      <button
                        onClick={() => handleRating('good')}
                        className="py-3.5 sm:py-4 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 font-bold rounded-2xl transition-all text-xs sm:text-sm flex flex-col items-center shadow-lg shadow-amber-500/5 active:scale-95"
                      >
                        <span>Good</span>
                        <span className="text-[10px] text-amber-400/70 font-normal mt-0.5">{formatInterval(nextInterval(activeCard.interval, 'good'))}</span>
                      </button>
                      <button
                        onClick={() => handleRating('easy')}
                        className="py-3.5 sm:py-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold rounded-2xl transition-all text-xs sm:text-sm flex flex-col items-center shadow-lg shadow-emerald-500/5 active:scale-95"
                      >
                        <span>Easy</span>
                        <span className="text-[10px] text-emerald-400/70 font-normal mt-0.5">{formatInterval(nextInterval(activeCard.interval, 'easy'))}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white/[0.04] backdrop-blur-2xl border border-white/10 rounded-[28px] sm:rounded-[35px] p-6 sm:p-12 shadow-2xl text-center space-y-4 min-h-[320px] flex flex-col items-center justify-center">
                <div className="text-5xl">🎉</div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white">
                  {newLeft === 0 ? 'You have gone through every word!' : "You're done for today!"}
                </h2>
                <p className="text-sm text-slate-400 max-w-md">
                  {nextDue !== null
                    ? `Your next review is due ${new Date(nextDue).toLocaleString()}.`
                    : 'No reviews are scheduled yet.'}
                  {newLeft > 0 && ` ${newLeft} new words are still waiting.`}
                </p>
                {newLeft > 0 && (
                  <button
                    onClick={() => setStudyMore(true)}
                    className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-2xl shadow-lg ring-1 ring-white/20 active:scale-95 transition-all"
                  >
                    Study more new words
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'dictionary' && (
          <div className="space-y-4 w-full min-w-0">
            <div className="bg-white/[0.04] backdrop-blur-2xl border border-white/10 rounded-[28px] sm:rounded-[35px] p-4 sm:p-8 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/10 gap-3 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-3">
                  <div className="bg-indigo-500/20 p-2 rounded-xl text-indigo-400 ring-1 ring-indigo-500/30">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <span>N5 Words List</span>
                </h2>
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  {totalWords} Words
                </span>
              </div>

              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by Japanese, reading, English or number…"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />

              <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
                {dictionaryMatches.slice(0, DICTIONARY_LIMIT).map((word) => (
                  <div
                    key={word.id}
                    className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/10 rounded-2xl p-3.5 sm:p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner"
                  >
                    <div className="flex items-baseline space-x-3 sm:space-x-4 min-w-0">
                      <span className="text-xs font-mono text-slate-500 w-9 shrink-0">#{word.id}</span>
                      <div className="min-w-0">
                        <div className="flex items-baseline flex-wrap gap-x-2">
                          <span className="text-lg sm:text-xl font-extrabold text-white tracking-wide">{word.kanji}</span>
                          {word.kana !== word.kanji && (
                            <span className="text-xs sm:text-sm text-indigo-300 font-medium">【{word.kana}】</span>
                          )}
                        </div>
                        <div className="text-sm text-emerald-400 font-semibold mt-0.5">{word.meaning}</div>
                      </div>
                    </div>

                    {word.example && (
                      <div className="bg-black/30 px-3 py-2 rounded-xl border border-white/5 text-xs text-slate-300 sm:max-w-xs">
                        <div className="font-medium text-slate-200 text-sm">
                          <FuriganaText text={word.example} />
                        </div>
                        <div className="text-slate-400 italic text-[11px] mt-0.5">{word.exampleMeaning}</div>
                      </div>
                    )}
                  </div>
                ))}
                {dictionaryMatches.length === 0 && (
                  <div className="text-sm text-slate-400 text-center py-8">No words match “{search}”.</div>
                )}
                {dictionaryMatches.length > DICTIONARY_LIMIT && (
                  <div className="text-xs text-slate-400 text-center py-3">
                    Showing the first {DICTIONARY_LIMIT} of {dictionaryMatches.length} matches. Type to narrow the search.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-white/[0.04] backdrop-blur-2xl border border-white/10 rounded-[28px] sm:rounded-[35px] p-5 sm:p-8 shadow-2xl space-y-6">
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-3">
                <div className="bg-indigo-500/20 p-2.5 rounded-2xl text-indigo-400 ring-1 ring-indigo-500/30">
                  <Award className="w-6 h-6" />
                </div>
                <span>N5 Vocabulary Mastery Stats</span>
              </h2>

              <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                <div className="min-w-0 bg-white/[0.03] backdrop-blur p-3.5 sm:p-5 rounded-2xl border border-white/10 text-center shadow-inner">
                  <div className="text-2xl sm:text-3xl font-black text-emerald-400">{masteredCount}</div>
                  <div className="text-xs text-slate-400 font-medium mt-1 truncate">Mastered</div>
                </div>
                <div className="min-w-0 bg-white/[0.03] backdrop-blur p-3.5 sm:p-5 rounded-2xl border border-white/10 text-center shadow-inner">
                  <div className="text-2xl sm:text-3xl font-black text-amber-400">{learningCount}</div>
                  <div className="text-xs text-slate-400 font-medium mt-1 truncate">Learning</div>
                </div>
                <div className="min-w-0 bg-white/[0.03] backdrop-blur p-3.5 sm:p-5 rounded-2xl border border-white/10 text-center shadow-inner">
                  <div className="text-2xl sm:text-3xl font-black text-blue-400">{newCount}</div>
                  <div className="text-xs text-slate-400 font-medium mt-1 truncate">New</div>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex justify-between text-xs text-slate-300 font-medium">
                  <span>Overall Completion</span>
                  <span>{Math.round(((masteredCount + learningCount) / totalWords) * 100)}%</span>
                </div>
                <div className="w-full bg-white/[0.04] h-3.5 rounded-full overflow-hidden p-0.5 border border-white/10 shadow-inner">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 h-full rounded-full transition-all duration-500 shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                    style={{ width: `${((masteredCount + learningCount) / totalWords) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-white/[0.04] backdrop-blur-2xl border border-white/10 rounded-[28px] sm:rounded-[35px] p-5 sm:p-8 shadow-2xl space-y-6">
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-3">
                <div className="bg-indigo-500/20 p-2.5 rounded-2xl text-indigo-400 ring-1 ring-indigo-500/30">
                  <Settings className="w-6 h-6" />
                </div>
                <span>Goal & Schedule Settings</span>
              </h2>

              <div className="space-y-4">
                <label className="text-sm font-medium text-slate-300 flex justify-between gap-3">
                  <span>Target Days to Learn All {totalWords.toLocaleString()} N5 Words:</span>
                  <span className="text-indigo-400 font-bold whitespace-nowrap">{targetDays} Days</span>
                </label>
                <input
                  type="range"
                  min="15"
                  max="180"
                  step="5"
                  value={targetDays}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setTargetDays(val);
                    safeSet(KEY_TARGET, val.toString());
                  }}
                  className="w-full accent-indigo-500 bg-white/[0.06] h-2.5 rounded-lg cursor-pointer"
                />
                <p className="text-xs text-slate-400 font-medium">
                  At {targetDays} days, you will learn about {dailyTargetQuota} new words a day, plus whatever reviews are due.
                </p>
              </div>

              <div className="pt-4 border-t border-white/10 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200">Data Backup & Restore</h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleExportBackup}
                    className="px-4 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-medium rounded-xl border border-indigo-500/30 text-xs transition-all flex items-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export JSON Backup</span>
                  </button>

                  <label className="px-4 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-medium rounded-xl border border-emerald-500/30 text-xs transition-all flex items-center space-x-2 cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>Import JSON Backup</span>
                    <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10">
                <button
                  onClick={handleReset}
                  className="px-4 py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-semibold rounded-2xl border border-rose-500/30 text-xs transition-all flex items-center space-x-2 shadow-lg shadow-rose-500/5 active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset All Progress & Restart</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}