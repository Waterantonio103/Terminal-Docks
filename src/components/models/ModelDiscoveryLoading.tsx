import { type FC } from 'react';
import { ClaudeModelLoading } from './loaders/ClaudeModelLoading';
import { CodexModelLoading } from './loaders/CodexModelLoading';
import { DefaultModelLoading } from './loaders/DefaultModelLoading';
import { GeminiModelLoading } from './loaders/GeminiModelLoading';
import { OpenCodeModelLoading } from './loaders/OpenCodeModelLoading';

export type ModelDiscoveryPhase =
  | 'checking-command'
  | 'reading-cache'
  | 'reading-config'
  | 'parsing-models'
  | 'searching'
  | 'refreshing'
  | 'failed';

export interface ModelDiscoveryLoadingProps {
  cli?: string | null;
  phase?: ModelDiscoveryPhase;
  className?: string;
}

function normalizeModelCli(value: unknown): string {
  if (typeof value !== 'string') return 'default';
  const key = value.trim().toLowerCase().replace(/[_-]/g, '');
  if (key === 'claude' || key === 'claudecode') return 'claude';
  if (key === 'gemini') return 'gemini';
  if (key === 'codex') return 'codex';
  if (key === 'opencode' || key === 'opencode') return 'opencode';
  return 'default';
}

export const ModelDiscoveryLoading: FC<ModelDiscoveryLoadingProps> = ({ cli, phase, className }) => {
  const normalized = normalizeModelCli(cli);

  switch (normalized) {
    case 'claude':
      return <ClaudeModelLoading phase={phase} className={className} />;
    case 'gemini':
      return <GeminiModelLoading phase={phase} className={className} />;
    case 'codex':
      return <CodexModelLoading phase={phase} className={className} />;
    case 'opencode':
      return <OpenCodeModelLoading phase={phase} className={className} />;
    default:
      return <DefaultModelLoading phase={phase} className={className} />;
  }
};
