import { type FC, useEffect, useRef, useState } from 'react';

type Phase = 'checking-command' | 'reading-cache' | 'reading-config' | 'parsing-models' | 'searching' | 'refreshing' | 'failed';

interface GeminiModelLoadingProps {
  phase?: Phase;
  className?: string;
}

const FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

const COLOR_STOPS = [
  [66, 133, 244],
  [234, 67, 53],
  [251, 188, 5],
  [52, 168, 83],
  [161, 66, 244],
];

function lerpColor(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

const PHASE_TEXT: Record<Phase, string> = {
  'checking-command': 'Checking Gemini...',
  'reading-cache': 'Reading cache...',
  'reading-config': 'Reading config...',
  'parsing-models': 'Finding models...',
  searching: 'Thinking...',
  refreshing: 'Refreshing models...',
  failed: 'Search failed',
};

export const GeminiModelLoading: FC<GeminiModelLoadingProps> = ({ phase, className }) => {
  const [step, setStep] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setInterval(() => setStep(i => i + 1), 160);
    return () => clearInterval(timerRef.current);
  }, []);

  const text = PHASE_TEXT[phase ?? 'searching'];
  const frameIdx = step % FRAMES.length;
  const colorStep = step % (COLOR_STOPS.length * 4);
  const segIdx = Math.floor(colorStep / 4);
  const t = (colorStep % 4) / 4;
  const from = COLOR_STOPS[segIdx % COLOR_STOPS.length];
  const to = COLOR_STOPS[(segIdx + 1) % COLOR_STOPS.length];
  const color = lerpColor(from, to, t);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Searching Gemini models"
      className={`flex items-center gap-[7px] px-2 py-1.5 ${className ?? ''}`}
    >
      <span
        className="inline-block w-[14px] text-center shrink-0 font-mono text-[13px] leading-none"
        style={{ color }}
      >
        {FRAMES[frameIdx]}
      </span>
      <span className="text-[11px] text-text-secondary truncate">{text}</span>
    </div>
  );
};
