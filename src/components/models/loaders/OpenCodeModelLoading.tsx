import { type FC, useEffect, useRef, useState } from 'react';

type Phase = 'checking-command' | 'reading-cache' | 'reading-config' | 'parsing-models' | 'searching' | 'refreshing' | 'failed';

interface OpenCodeModelLoadingProps {
  phase?: Phase;
  className?: string;
}

const TOTAL_CELLS = 8;
const WINDOW_SIZE = 3;
const FRAME_MS = 120;

const PHASE_TEXT: Record<Phase, string> = {
  'checking-command': 'Checking OpenCode...',
  'reading-cache': 'Reading cache...',
  'reading-config': 'Reading config...',
  'parsing-models': 'Indexing providers...',
  searching: 'Refreshing models...',
  refreshing: 'Refreshing models...',
  failed: 'Search failed',
};

export const OpenCodeModelLoading: FC<OpenCodeModelLoadingProps> = ({ phase, className }) => {
  const [headIdx, setHeadIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setHeadIdx(i => (i + 1) % TOTAL_CELLS);
    }, FRAME_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  const text = PHASE_TEXT[phase ?? 'searching'];

  const isActive = (cellIndex: number) => {
    for (let offset = 0; offset < WINDOW_SIZE; offset++) {
      if (headIdx + offset === cellIndex) return true;
    }
    return false;
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Searching OpenCode models"
      className={`flex items-center gap-2 px-2 py-1.5 text-[11px] text-text-muted ${className ?? ''}`}
    >
      <span className="flex shrink-0" style={{ gap: 1 }}>
        {Array.from({ length: TOTAL_CELLS }, (_, i) => (
          <span
            key={i}
            className="inline-block"
            style={{
              width: 4,
              height: 6,
              background: isActive(i) ? '#A855F7' : 'rgba(139,92,246,0.18)',
              border: isActive(i) ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(168,85,247,0.25)',
              boxShadow: isActive(i) ? '0 0 4px rgba(192,132,252,0.45)' : 'none',
            }}
          />
        ))}
      </span>
      <span className="truncate">{text}</span>
    </div>
  );
};
