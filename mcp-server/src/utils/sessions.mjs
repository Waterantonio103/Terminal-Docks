import { sessions } from '../state.mjs';
import { db } from '../db/index.mjs';

export const WORKER_CAPABILITY_IDS = [
  'planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution',
];

export const ROLE_CAPABILITY_PRESETS = {
  scout: [{ id: 'repo_analysis', level: 3 }, { id: 'planning', level: 2 }, { id: 'shell_execution', level: 2 }],
  coordinator: [{ id: 'planning', level: 3 }, { id: 'repo_analysis', level: 2 }, { id: 'review', level: 2 }],
  builder: [{ id: 'coding', level: 3 }, { id: 'shell_execution', level: 3 }, { id: 'repo_analysis', level: 2 }],
  tester: [{ id: 'testing', level: 3 }, { id: 'coding', level: 2 }, { id: 'shell_execution', level: 2 }],
  security: [{ id: 'security', level: 3 }, { id: 'review', level: 2 }, { id: 'repo_analysis', level: 2 }],
  reviewer: [{ id: 'review', level: 3 }, { id: 'testing', level: 2 }, { id: 'security', level: 2 }, { id: 'coding', level: 1 }],
};

export const normalizeCapabilityId = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return WORKER_CAPABILITY_IDS.includes(normalized) ? normalized : null;
};

export function normalizeCapabilities(entries, fallback = []) {
  const byId = new Map();
  const list = [...(Array.isArray(entries) ? entries : []), ...fallback];
  for (const entry of list) {
    let id, level = 2;
    if (typeof entry === 'string') id = normalizeCapabilityId(entry);
    else if (entry && typeof entry === 'object') {
      id = normalizeCapabilityId(entry.id);
      level = Math.max(0, Math.min(3, entry.level ?? 2));
    }
    if (id && (!byId.has(id) || level > byId.get(id).level)) byId.set(id, { id, level });
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function defaultCapabilitiesForRole(roleId) {
  return normalizeCapabilities(ROLE_CAPABILITY_PRESETS[roleId] ?? []);
}

export function effectiveSessionCapabilities(session) {
  if (session?.capabilities?.length > 0) return normalizeCapabilities(session.capabilities);
  return defaultCapabilitiesForRole(session?.role);
}

export function summarizeSession(sessionId, session) {
  return {
    sessionId,
    role: session.role ?? null,
    agentId: session.agentId ?? null,
    status: session.status ?? 'idle',
    capabilities: effectiveSessionCapabilities(session),
  };
}

export function sessionLoadForAssignment(sessionId) {
  const row = db.prepare("SELECT COUNT(1) AS active_count FROM tasks WHERE agent_id = ? AND status IN ('todo', 'in-progress')").get(sessionId);
  return Number(row?.active_count ?? 0);
}

export function evaluateWorkerForRequirements(sessionId, session, options) {
  const { requiredCapabilities, preferredCapabilities = [], workingDir } = options;
  const capabilities = effectiveSessionCapabilities(session);
  const byId = new Map(capabilities.map(c => [c.id, c]));

  const missing = requiredCapabilities.filter(id => !byId.has(id));
  if (missing.length > 0) return { eligible: false, sessionId, reason: 'missing_capabilities' };

  if (workingDir && session.workingDir !== workingDir) return { eligible: false, sessionId, reason: 'working_dir_mismatch' };

  const reqScore = requiredCapabilities.reduce((s, id) => s + (byId.get(id)?.level ?? 0), 0);
  const prefMatches = preferredCapabilities.filter(id => byId.has(id));
  const prefScore = prefMatches.reduce((s, id) => s + (byId.get(id)?.level ?? 0), 0);
  const load = sessionLoadForAssignment(sessionId);

  return { eligible: true, sessionId, score: (reqScore * 10) + (prefScore * 5) - (load * 2) };
}
