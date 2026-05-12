import type { FrontendSpecCategory, FrontendWorkflowMode } from '../store/workspace.js';

export const FRONTEND_WORKFLOW_MODES: Array<{ value: FrontendWorkflowMode; label: string }> = [
  { value: 'off', label: 'Standard' },
  { value: 'fast', label: 'UI Fast' },
  { value: 'aligned', label: 'UI Aligned' },
  { value: 'strict_ui', label: 'Strict UI' },
];

const CATEGORY_CUES: Array<{ category: FrontendSpecCategory; cues: string[] }> = [
  {
    category: 'docs_portal',
    cues: ['docs', 'documentation', 'api reference', 'quickstart', 'migration', 'changelog', 'developer portal'],
  },
  {
    category: 'admin_internal_tool',
    cues: ['admin', 'internal', 'operations console', 'dispatch', 'moderation', 'back office', 'queue', 'audit'],
  },
  {
    category: 'saas_dashboard',
    cues: ['saas', 'dashboard', 'analytics', 'platform', 'subscription', 'integrations', 'metric'],
  },
  {
    category: 'consumer_mobile_app',
    cues: ['mobile app', 'consumer', 'onboarding', 'habit', 'fitness', 'account', 'progress'],
  },
  {
    category: 'marketing_site',
    cues: ['landing page', 'marketing site', 'website', 'brand site', 'portfolio', 'venue', 'product page'],
  },
];

export function inferFrontendCategory(prompt: string): FrontendSpecCategory {
  const text = prompt.toLowerCase();
  let best: { category: FrontendSpecCategory; score: number } = { category: 'marketing_site', score: 0 };
  for (const entry of CATEGORY_CUES) {
    const score = entry.cues.filter(cue => text.includes(cue)).length;
    if (score > best.score) best = { category: entry.category, score };
  }
  return best.category;
}

export function resolveFrontendCategory(prompt: string): FrontendSpecCategory {
  return inferFrontendCategory(prompt);
}
