export const CHANGE_REVIEW_APPLIED_EVENT = 'change-review:applied';

export interface ChangeReviewAppliedEvent {
  missionId?: string | null;
  threadId?: string | null;
  runtimeSessionId?: string | null;
  cardId?: string | null;
  title?: string | null;
  mode: 'accepted' | 'all';
  status: 'completed' | 'failed';
  hunkCount: number;
  filePaths: string[];
  artifactIds: string[];
  error?: string | null;
}

export function formatChangeReviewAppliedActionContent(event: ChangeReviewAppliedEvent): string {
  const target = event.filePaths.length > 0
    ? event.filePaths.join(', ')
    : event.artifactIds.length > 0
      ? event.artifactIds.join(', ')
      : `${event.hunkCount} hunk${event.hunkCount === 1 ? '' : 's'}`;
  return [
    'Action result',
    'Kind: patch_review',
    `Status: ${event.status}`,
    event.cardId?.trim() ? `Card ID: ${event.cardId.trim()}` : '',
    `Title: ${event.title?.trim() || `Applied ${event.mode === 'all' ? 'all' : 'accepted'} patch hunks`}`,
    `Target: ${target}`,
    event.error?.trim() ? `Error: ${event.error.trim()}` : '',
  ].filter(Boolean).join('\n');
}
