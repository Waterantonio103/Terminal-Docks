import { type FC, useEffect, useRef, useState } from 'react';

type Phase = 'checking-command' | 'reading-cache' | 'reading-config' | 'parsing-models' | 'searching' | 'refreshing' | 'failed';

interface CodexModelLoadingProps {
  phase?: Phase;
  className?: string;
}

const PHASE_TEXT: Record<Phase, string> = {
  'checking-command': 'Checking Codex...',
  'reading-cache': 'Reading cache...',
  'reading-config': 'Reading config...',
  'parsing-models': 'Working...',
  searching: 'Working...',
  refreshing: 'Working...',
  failed: 'Search failed',
};

export const CodexModelLoading: FC<CodexModelLoadingProps> = ({ phase, className }) => {
  const text = PHASE_TEXT[phase ?? 'searching'];
  const [hlIdx, setHlIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setHlIdx(i => (i + 1) % text.length);
    }, 140);
    return () => clearInterval(timerRef.current);
  }, [text.length]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Searching Codex models"
      className={`flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-muted ${className ?? ''}`}
    >
      <span className="codex-blink-dot inline-block w-[5px] h-[5px] rounded-full bg-current shrink-0" />
      <span className="truncate">
        {text.split('').map((ch, i) => (
          <span
            key={i}
            style={{
              color: i === hlIdx ? 'rgba(255,255,255,0.92)' : undefined,
              textShadow: i === hlIdx ? '0 0 4px rgba(255,255,255,0.15)' : undefined,
            }}
          >
            {ch}
          </span>
        ))}
      </span>
      <span
        className="codex-blink-cursor inline-block w-[3px] h-[10px] bg-text-muted/60 rounded-[1px] shrink-0"
      />
    </div>
  );
};
