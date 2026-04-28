import { type FC } from 'react';

type Phase = 'checking-command' | 'reading-cache' | 'reading-config' | 'parsing-models' | 'searching' | 'refreshing' | 'failed';

interface DefaultModelLoadingProps {
  phase?: Phase;
  className?: string;
}

const PHASE_TEXT: Record<Phase, string> = {
  'checking-command': 'Checking...',
  'reading-cache': 'Reading cache...',
  'reading-config': 'Reading config...',
  'parsing-models': 'Parsing models...',
  searching: 'Searching models...',
  refreshing: 'Refreshing...',
  failed: 'Search failed',
};

export const DefaultModelLoading: FC<DefaultModelLoadingProps> = ({ phase, className }) => {
  const text = PHASE_TEXT[phase ?? 'searching'];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Searching models"
      className={`flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-muted ${className ?? ''}`}
    >
      <span className="flex items-center gap-[3px]">
        <span className="default-loading-dot inline-block w-[4px] h-[4px] rounded-full bg-text-muted" style={{ animationDelay: '0ms' }} />
        <span className="default-loading-dot inline-block w-[4px] h-[4px] rounded-full bg-text-muted" style={{ animationDelay: '120ms' }} />
        <span className="default-loading-dot inline-block w-[4px] h-[4px] rounded-full bg-text-muted" style={{ animationDelay: '240ms' }} />
      </span>
      <span>{text}</span>
    </div>
  );
};
