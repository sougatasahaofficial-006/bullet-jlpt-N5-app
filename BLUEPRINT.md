# Blueprint: Bullet JLPT — JLPT N5 Edition

**Bullet JLPT — JLPT N5 Edition** is an offline-first Japanese vocabulary memorization application designed around spaced repetition (SRS), customizable daily study targets, local persistence, and native Android packaging via Capacitor.

---

## 1. System Architecture Overview

The application runs as a client-side React + TypeScript single-page application bundled with Vite and Tailwind CSS, and packaged for Android through Capacitor.

```text
+-------------------------------------------------------+
|                   Android OS Layer                    |
|  MainActivity.java  |  styles.xml  |  mipmap icons    |
|  @capacitor/android | @capacitor/filesystem | @capacitor/share |
+---------------------------+---------------------------+
                            | Capacitor Bridge
+---------------------------v---------------------------+
|                 WebView / Web Layer                   |
|               src/App.tsx (UI & State)                |
|   src/srs.ts (Scheduling)  |  src/furigana.tsx        |
|           src/n5Vocabulary.ts (1,046 Words)           |
+---------------------------+---------------------------+
                            |
+---------------------------v---------------------------+
|              Local Persistence Layer                  |
|    localStorage (progress, daily quota, streak, goal) |
|      JSON Backup & Restore (Import / Export/Share)    |
+-------------------------------------------------------+
```

### Key Design Principles

* **100% Offline Operation:** All 1,046 N5 vocabulary items and SRS scheduling calculations execute locally without external API calls.
* **Resilient Storage:** `localStorage` reads and writes are wrapped in `try/catch` helpers (`safeGet`, `safeSet`, `safeParse`) so storage restrictions or malformed JSON never crash startup.
* **Native + Web Parity:** Core UI and SRS logic run identically on web and Android, with native Capacitor plugins handling file export and sharing on mobile.

---

## 2. Core Modules & Data Flow

### Vocabulary Dataset (`src/n5Vocabulary.ts`)
* Exports `N5_VOCAB_DATA` (1,046 JLPT N5 entries) and `VOCAB_VERSION`.
* Each entry (`VocabItem`) carries word metadata (`id`, `kanji`, `kana`, `meaning`, optional `example` and `exampleMeaning`) alongside SRS state (`interval`, `repetitions`, `dueDate`, `state`).
* On load (`loadQueue`), saved progress is merged with `N5_VOCAB_DATA` via `mergeProgress(...)`, preserving learner history across app updates while keeping `VOCAB_VERSION` synchronized.

### Spaced Repetition Engine (`src/srs.ts`)
* **`pickNext(queue, now, newAllowed)`:** Selects the next card to study, prioritizing due review items (`pick.kind === 'review'`) and introducing new items up to `newAllowed` (bounded by the daily target quota unless `studyMore` is enabled).
* **`applyRating(item, rating, now)` & `nextInterval(...)`:** Computes updated review intervals and next due timestamps for ratings (`'again'`, `'good'`, `'easy'`), transitioning items across `'new'`, `'learning'`, and `'mastered'` states.
* **`computeStreak(studyDays, now)` & `dayKey(timestamp)`:** Tracks consecutive active study days using normalized day keys (`studyDays` capped to the most recent 400 days).
* **`formatInterval(...)` & `nextDueAt(...)`:** Formats interval labels on rating buttons and determines when the next scheduled review becomes due if the daily queue is empty.

### Furigana Renderer (`src/furigana.tsx`)
* Renders example sentences with reading aids/furigana inside the **Study** card answer view and the **Words** list.

### Application State & Navigation (`src/App.tsx`)
Manages four top-level tabs (`activeTab`):
1. **`study`:** Displays the 3-column stat bar (**Streak**, **Today** reviewed vs. daily target quota, **Target** days) and the active flashcard with answer reveal and `Again` / `Good` / `Easy` rating buttons—or a completion/next-review prompt with an optional *"Study more new words"* action.
2. **`dictionary` (labeled `Words` in the nav bar):** Provides live search across word `id`, `kanji`, `kana`, and `meaning` (capped at `DICTIONARY_LIMIT = 200` rendered rows at a time for smooth scrolling).
3. **`dashboard` (`Progress` tab):** Summarizes `Mastered`, `Learning`, and `New` counts alongside an overall completion percentage bar.
4. **`settings`:** Configures `targetDays` (`15` to `180` days, defaulting to `45`), dynamically recalculating `dailyTargetQuota = Math.ceil(totalWords / targetDays)`, and handles JSON export/import and full progress reset.

---

## 3. Daily Quota & Progress Persistence

| Storage Key | Purpose | Default / Behavior |
| :--- | :--- | :--- |
| `n5_vocab_progress` | Serialized `VocabItem[]` queue with SRS intervals and states | Merged from `N5_VOCAB_DATA` on first run |
| `n5_vocab_version` | Tracks dataset version (`VOCAB_VERSION`) | Updated alongside `n5_vocab_progress` |
| `n5_target_days` | Target completion window in days | Integer in `[15, 180]`, default `45` |
| `n5_daily` | `{ date, reviewed, newIntroduced }` for the current day | Resets automatically when `dayKey(Date.now())` changes |
| `n5_study_days` | Array of active study day keys | Deduplicated, sorted on import, capped at 400 entries |

### Backup & Restore Flow
* **Export:** Collects cards with `repetitions > 0`, `studyDays`, `version`, and `exportedAt` into a timestamped `bullet_jlpt_backup_YYYY-MM-DD.json` payload. On native Android (`Capacitor.isNativePlatform()`), writes the file via `@capacitor/filesystem` and invokes `@capacitor/share` so the user can save or send it via the system share sheet; on web, triggers a standard `Blob` download.
* **Import:** Reads a `.json` file via `FileReader`, supports both structured backup objects (`{ version, studyDays, progress }`) and legacy plain progress arrays, merges via `mergeProgress(...)`, and unions `studyDays`.

---

## 4. Layout & Native Android Layer

### Responsive Mobile Styling (`index.html`, `src/index.css`, `src/App.tsx`)
* `index.html` sets `viewport-fit=cover` and dark `#070913` styling.
* `src/index.css` constrains `html`, `body`, and `#root` to `max-width: 100vw`, `min-height: 100dvh`, and `overflow-x: hidden`.
* `src/App.tsx` uses a 4-column responsive tab grid (`Study`, `Words`, `Progress`, `Settings`) with `min-w-0` and `truncate` so labels fit narrow viewports without right-edge clipping, a 3-column stat grid with `whitespace-nowrap` values so `0/24` and `Days` stay aligned, and top-aligned `<main>` flow (`justify-start`) to avoid vertical gaps.

### Capacitor & Android Project (`android/`)
* Configured via `capacitor.config.json` with `webDir: "dist"`.
* `MainActivity.java` extends `BridgeActivity` and configures window/system bar insets and status/navigation bar styling.
* `android/app/src/main/res/values/styles.xml` defines `NoActionBar` and splash themes (`AppTheme.NoActionBar`, `AppTheme.NoActionBarLaunch`) aligned with `#070913`.
* Launcher icons (`ic_launcher.png`, `ic_launcher_round.png`, `ic_launcher_foreground.png`) are generated across `mipmap-*` densities using Python (`Pillow`) with safe padding to prevent clipping in adaptive launcher masks.

---

## 5. Build & Release Workflow

1. **Build web bundle:** `npm run build` (`tsc && vite build` $\rightarrow$ outputs to `dist/`).
2. **Sync native project:** `npx cap sync android` (copies `dist/` and updates Capacitor plugins/Gradle config).
3. **Compile APK in Android Studio:** Open `android/`, run **Build $\rightarrow$ Clean Project**, then **Build $\rightarrow$ Build Bundle(s) / APK(s) $\rightarrow$ Build APK(s)** to produce `app-debug.apk`.