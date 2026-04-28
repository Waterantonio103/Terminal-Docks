import { type FC, useEffect, useRef, useState } from 'react';

type Phase = 'checking-command' | 'reading-cache' | 'reading-config' | 'parsing-models' | 'searching' | 'refreshing' | 'failed';

interface ClaudeModelLoadingProps {
  phase?: Phase;
  className?: string;
}

const GLYPHS = [
  '\u00B7',
  '\u2722\uFE0E',
  '\u2733\uFE0E',
  '\u2736\uFE0E',
  '\u273B\uFE0E',
  '\u273D\uFE0E',
];

const VERBS = [
  'Reticulating', 'Discombobulating', 'Shenaniganing', 'Flibbertigibbeting',
  'Sussing', 'Finagling', 'Moseying', 'Concocting', 'Bedazzling',
  'Saut\u00E9ing', 'Pondering', 'Wrangling', 'Polishing', 'Perambulating',
];

const NOUNS = ['models', 'options', 'providers', 'settings', 'choices'];

const PHASE_TEXT: Partial<Record<Phase, string>> = {
  'checking-command': 'Checking Claude...',
  'reading-config': 'Reading settings...',
  'parsing-models': 'Finagling options...',
  'refreshing': 'Reticulating models...',
  failed: 'Search failed',
};

function getPhrase(index: number): string {
  const verb = VERBS[index % VERBS.length];
  const noun = NOUNS[Math.floor(index / VERBS.length) % NOUNS.length];
  return `${verb} ${noun}...`;
}

export const ClaudeModelLoading: FC<ClaudeModelLoadingProps> = ({ phase, className }) => {
  const [glyphIdx, setGlyphIdx] = useState(() => Math.floor(Math.random() * GLYPHS.length));
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * VERBS.length));
  const [hlIdx, setHlIdx] = useState(0);
  const glyphRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const phraseRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const hlRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const override = PHASE_TEXT[phase ?? 'searching'];
  const text = override ?? getPhrase(phraseIdx);

  useEffect(() => {
    glyphRef.current = setInterval(() => setGlyphIdx(i => (i + 1) % GLYPHS.length), 110);
    phraseRef.current = setInterval(() => setPhraseIdx(i => i + 1), 1100);
    return () => {
      clearInterval(glyphRef.current);
      clearInterval(phraseRef.current);
    };
  }, []);

  useEffect(() => {
    hlRef.current = setInterval(() => setHlIdx(i => (i + 1) % text.length), 120);
    return () => clearInterval(hlRef.current);
  }, [text.length]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Searching Claude models"
      className={`flex items-center gap-[6px] px-2.5 py-1.5 ${className ?? ''}`}
    >
      <span
        className="inline-block w-[14px] text-center shrink-0 text-[13px] leading-none"
        style={{
          color: '#D97757',
          textShadow: '0 0 6px rgba(245,158,11,0.35)',
          fontFamily: 'Georgia, Times New Roman, serif',
        }}
      >
        {GLYPHS[glyphIdx]}
      </span>
      <span className="text-[11px] truncate" style={{ color: '#D97757' }}>
        {text.split('').map((ch, i) => (
          <span
            key={i}
            style={{
              color: i === hlIdx ? 'rgba(255,220,180,0.95)' : undefined,
              textShadow: i === hlIdx ? '0 0 5px rgba(255,160,80,0.5)' : undefined,
            }}
          >{ch}</span>
        ))}
      </span>
    </div>
  );
};
