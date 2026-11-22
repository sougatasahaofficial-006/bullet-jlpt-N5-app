import React from 'react';

export interface FuriganaSegment {
  base: string;
  ruby?: string;
}

const PATTERN = /\{([^|{}]+)\|([^|{}]+)\}/g;

/** Split "{私|わたし}は{学生|がくせい}です。" into text and base+ruby segments. */
export function parseFurigana(text: string): FuriganaSegment[] {
  const out: FuriganaSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ base: text.slice(last, start) });
    out.push({ base: m[1], ruby: m[2] });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ base: text.slice(last) });
  return out;
}

export function stripFurigana(text: string): string {
  return text.replace(PATTERN, '$1');
}

export function FuriganaText({ text }: { text: string }) {
  const segments = parseFurigana(text);
  return (
    <span className="inline-flex flex-wrap items-end justify-center leading-tight">
      {segments.map((s, i) =>
        s.ruby ? (
          <span key={i} className="inline-flex flex-col items-center">
            <span className="text-[10px] text-indigo-400 font-normal leading-none mb-0.5">
              {s.ruby}
            </span>
            <span>{s.base}</span>
          </span>
        ) : (
          <span key={i}>{s.base}</span>
        ),
      )}
    </span>
  );
}
