import { type FC, useEffect, useRef, useState } from 'react';

export interface AgentActionBadgeProps {
  cli?: string | null;
  status?: string;
  className?: string;
}

function normalizeCli(value: unknown): string {
  if (typeof value !== 'string') return 'default';
  const key = value.trim().toLowerCase().replace(/[_-]/g, '');
  if (key === 'claude' || key === 'claudecode') return 'claude';
  if (key === 'gemini') return 'gemini';
  if (key === 'codex') return 'codex';
  if (key === 'opencode') return 'opencode';
  return 'default';
}

const WORKING = new Set(['activated', 'activation_acked', 'running', 'handoff_pending', 'waiting']);
const TERMINAL_STATUSES = new Set(['done', 'completed', 'failed']);

const CLAUDE_VERBS = [
  'Reticulating', 'Discombobulating', 'Shenaniganing', 'Flibbertigibbeting',
  'Sussing', 'Finagling', 'Moseying', 'Concocting', 'Bedazzling',
  'Saut\u00E9ing', 'Pondering', 'Wrangling', 'Polishing', 'Perambulating',
];

const CLAUDE_IDLES = ['Idling', 'Lounging', 'Loitering', 'Chilling', 'Hanging', 'Dawdling', 'Linger', 'Mulling'];

const CLAUDE_GLYPHS = ['\u00B7', '\u2722\uFE0E', '\u2733\uFE0E', '\u2736\uFE0E', '\u273B\uFE0E', '\u273D\uFE0E'];

const GEMINI_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
const GEMINI_COLORS: number[][] = [[66,133,244],[234,67,53],[251,188,5],[52,168,83],[161,66,244]];

function lerpColor(a: number[], b: number[], t: number): string {
  return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
}

function idleLabel(status?: string): string {
  if (!status) return '\u2014';
  if (status === 'idle' || status === 'unbound' || status === 'disconnected') return 'Idling...';
  if (status === 'done' || status === 'completed') return 'Done.';
  if (status === 'failed') return 'Failed.';
  if (status === 'bound' || status === 'ready') return 'Ready.';
  return status.replace(/_/g, ' ') + '...';
}

const CLAUDE_STYLE = { color: '#D97757', textShadow: '0 0 6px rgba(245,158,11,0.35)', fontFamily: 'Georgia, Times New Roman, serif' };
const CLAUDE_TEXT = { color: '#D97757' };

function ClaudeBadge({ working, status }: { working: boolean; status?: string }) {
  const [glyphIdx, setGlyphIdx] = useState(0);
  const [wordIdx, setWordIdx] = useState(() => Math.floor(Math.random() * CLAUDE_VERBS.length));
  const [hlIdx, setHlIdx] = useState(0);
  const gRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const wRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const hRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const text = working
    ? `${CLAUDE_VERBS[wordIdx]}...`
    : TERMINAL_STATUSES.has(status ?? '')
      ? idleLabel(status)
      : `${CLAUDE_IDLES[wordIdx % CLAUDE_IDLES.length]}...`;

  useEffect(() => {
    if (working) {
      gRef.current = setInterval(() => setGlyphIdx(i => (i + 1) % CLAUDE_GLYPHS.length), 110);
      wRef.current = setInterval(() => setWordIdx(i => (i + 1) % CLAUDE_VERBS.length), 1100);
    }
    return () => { clearInterval(gRef.current); clearInterval(wRef.current); };
  }, [working]);

  useEffect(() => {
    hRef.current = setInterval(() => setHlIdx(i => (i + 1) % text.length), 120);
    return () => clearInterval(hRef.current);
  }, [text.length]);

  return (
    <span className="flex items-center gap-1 truncate">
      <span className="inline-block w-3 text-center shrink-0 text-[10px] leading-none" style={CLAUDE_STYLE}>
        {working ? CLAUDE_GLYPHS[glyphIdx] : CLAUDE_GLYPHS[CLAUDE_GLYPHS.length - 1]}
      </span>
      <span style={CLAUDE_TEXT}>
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
    </span>
  );
}

function GeminiBadge({ working, status }: { working: boolean; status?: string }) {
  const [step, setStep] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (working) {
      timer.current = setInterval(() => setStep(i => i + 1), 160);
    }
    return () => clearInterval(timer.current);
  }, [working]);

  const fi = step % GEMINI_FRAMES.length;
  const cs = step % (GEMINI_COLORS.length * 4);
  const si = Math.floor(cs / 4);
  const t = (cs % 4) / 4;
  const color = lerpColor(GEMINI_COLORS[si % GEMINI_COLORS.length], GEMINI_COLORS[(si + 1) % GEMINI_COLORS.length], t);
  const text = working ? 'Thinking...' : idleLabel(status);

  return (
    <span className="flex items-center gap-1.5 truncate">
      <span className="inline-block w-3 text-center shrink-0 font-mono text-[10px] leading-none" style={{ color: working ? color : 'rgb(66,133,244)' }}>
        {working ? GEMINI_FRAMES[fi] : '⣿'}
      </span>
      <span className="text-text-secondary">{text}</span>
    </span>
  );
}

function CodexBadge({ working, status }: { working: boolean; status?: string }) {
  const label = working ? 'Working...' : idleLabel(status);
  const [hlIdx, setHlIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (working) {
      timer.current = setInterval(() => setHlIdx(i => (i + 1) % label.length), 140);
    }
    return () => clearInterval(timer.current);
  }, [working, label.length]);

  return (
    <span className="flex items-center gap-1 truncate">
      <span className={`inline-block w-[4px] h-[4px] rounded-full bg-text-muted shrink-0 ${working ? 'codex-blink-dot' : ''}`} />
      <span className="text-text-muted">
        {label.split('').map((ch, i) => (
          <span
            key={i}
            style={{
              color: working && i === hlIdx ? 'rgba(255,255,255,0.92)' : undefined,
              textShadow: working && i === hlIdx ? '0 0 4px rgba(255,255,255,0.15)' : undefined,
            }}
          >
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}

function OpenCodeBadge({ working, status }: { working: boolean; status?: string }) {
  const [headIdx, setHeadIdx] = useState(2);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (working) {
      timer.current = setInterval(() => setHeadIdx(i => (i + 1) % 8), 120);
    }
    return () => clearInterval(timer.current);
  }, [working]);

  const isActive = (ci: number) => {
    if (!working) return false;
    for (let o = 0; o < 3; o++) {
      if (headIdx + o === ci) return true;
    }
    return false;
  };

  const text = working ? 'Processing...' : idleLabel(status);

  return (
    <span className="flex items-center gap-1.5 truncate">
      <span className="flex shrink-0" style={{ gap: 1 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <span
            key={i}
            className="inline-block"
            style={{
              width: 3, height: 5,
              background: isActive(i) ? '#A855F7' : 'rgba(139,92,246,0.18)',
              border: isActive(i) ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(168,85,247,0.25)',
              boxShadow: isActive(i) ? '0 0 3px rgba(192,132,252,0.45)' : 'none',
            }}
          />
        ))}
      </span>
      <span className="text-text-muted">{text}</span>
    </span>
  );
}

function DefaultBadge({ working, status }: { working: boolean; status?: string }) {
  const text = working ? 'Processing...' : idleLabel(status);
  return (
    <span className="flex items-center gap-1 truncate">
      <span className="flex items-center gap-[2px]">
        <span className={`inline-block w-[3px] h-[3px] rounded-full bg-text-muted ${working ? 'default-loading-dot' : ''}`} style={{ animationDelay: '0ms' }} />
        <span className={`inline-block w-[3px] h-[3px] rounded-full bg-text-muted ${working ? 'default-loading-dot' : ''}`} style={{ animationDelay: '120ms' }} />
        <span className={`inline-block w-[3px] h-[3px] rounded-full bg-text-muted ${working ? 'default-loading-dot' : ''}`} style={{ animationDelay: '240ms' }} />
      </span>
      <span className="text-text-muted">{text}</span>
    </span>
  );
}

export const AgentActionBadge: FC<AgentActionBadgeProps> = ({ cli, status, className }) => {
  const normalized = normalizeCli(cli);
  const working = WORKING.has(status ?? '');

  const badge = (() => {
    switch (normalized) {
      case 'claude':   return <ClaudeBadge working={working} status={status} />;
      case 'gemini':   return <GeminiBadge working={working} status={status} />;
      case 'codex':    return <CodexBadge working={working} status={status} />;
      case 'opencode': return <OpenCodeBadge working={working} status={status} />;
      default:         return <DefaultBadge working={working} status={status} />;
    }
  })();

  return (
    <div role="status" aria-live="polite" className={`flex items-center text-[10px] ${className ?? ''}`}>
      {badge}
    </div>
  );
};
