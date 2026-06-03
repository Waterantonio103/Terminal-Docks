export interface AgentUsageLimitRow {
  id: string;
  label: string;
  percent: number;
  used?: number;
  total?: number;
  remaining?: number;
  reset?: string;
  sourceLine?: string;
}

export interface AgentUsageLimitPayload {
  kind: 'agent-usage-limits';
  cli: string;
  command: string;
  capturedAt: number;
  rows: AgentUsageLimitRow[];
  raw: string;
}

const USAGE_LIMIT_MESSAGE_PREFIX = '::agent-usage-limits';

const PERIOD_ORDER = new Map([
  ['5-hour', 0],
  ['hourly', 0],
  ['daily', 1],
  ['weekly', 2],
  ['monthly', 3],
]);

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseCompactNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^\s*([\d,.]+)\s*([kKmM])?\s*$/.exec(value);
  if (!match) return undefined;
  const base = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return undefined;
  const suffix = match[2]?.toLowerCase();
  if (suffix === 'k') return base * 1_000;
  if (suffix === 'm') return base * 1_000_000;
  return base;
}

function normalizeLimitLabel(line: string): string {
  if (/\b(?:5h|5[-\s_]?hour|five[-\s_]?hour)\b/i.test(line)) return '5-hour limit';
  const period = /\b(hourly|daily|weekly|monthly)\b/i.exec(line)?.[1]?.toLowerCase();
  if (period) return `${period[0].toUpperCase()}${period.slice(1)} limit`;
  const beforeColon = line.split(':')[0]?.trim();
  if (beforeColon && beforeColon.length <= 32) return beforeColon.replace(/\s+/g, ' ');
  return 'Usage limit';
}

function normalizeLimitId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'usage-limit';
}

function extractResetText(line: string): string | undefined {
  const match = /\b(?:resets?|reset)\s+(?:at|in|on)?\s*([^|,;]+)/i.exec(line);
  return match?.[1]?.trim();
}

function parseLimitLine(line: string): AgentUsageLimitRow | null {
  if (!/\b(5h|5[-\s_]?hour|five[-\s_]?hour|hourly|daily|weekly|monthly|limit|quota|usage)\b/i.test(line)) return null;

  const percentMatch = /(\d+(?:\.\d+)?)\s*%/.exec(line);
  const remainingPercentMatch = /(\d+(?:\.\d+)?)\s*%\s*(?:remaining|left)\b/i.exec(line);
  const usedPercentMatch = /(\d+(?:\.\d+)?)\s*%\s*(?:used|consumed)\b/i.exec(line);
  const usedTotalMatch = /([\d,.]+[kKmM]?)\s*(?:\/|of)\s*([\d,.]+[kKmM]?)/i.exec(line);
  const remainingMatch = /([\d,.]+[kKmM]?)\s*(?:remaining|left)\b/i.exec(line);
  const totalFromRemainingMatch = /\b(?:of|out of)\s+([\d,.]+[kKmM]?)/i.exec(line);

  const used = parseCompactNumber(usedTotalMatch?.[1]);
  const total = parseCompactNumber(usedTotalMatch?.[2] ?? totalFromRemainingMatch?.[1]);
  const remaining = parseCompactNumber(remainingMatch?.[1]);

  let percent = usedPercentMatch
    ? Number(usedPercentMatch[1])
    : remainingPercentMatch
      ? 100 - Number(remainingPercentMatch[1])
      : percentMatch
        ? Number(percentMatch[1])
        : undefined;
  if (percent === undefined && used !== undefined && total !== undefined && total > 0) {
    percent = (used / total) * 100;
  }
  if (percent === undefined && remaining !== undefined && total !== undefined && total > 0) {
    percent = ((total - remaining) / total) * 100;
  }
  if (percent === undefined) return null;

  const label = normalizeLimitLabel(line);
  return {
    id: normalizeLimitId(label),
    label,
    percent: clampPercent(percent),
    ...(used !== undefined ? { used } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(extractResetText(line) ? { reset: extractResetText(line) } : {}),
    sourceLine: line.trim(),
  };
}

function limitSortKey(row: AgentUsageLimitRow): number {
  if (/\b5-hour\b/i.test(row.label)) return 0;
  const period = /\b(hourly|daily|weekly|monthly)\b/i.exec(row.label)?.[1]?.toLowerCase();
  return PERIOD_ORDER.get(period ?? '') ?? 99;
}

export function parseAgentUsageLimits(rawOutput: string): AgentUsageLimitRow[] {
  const rowsById = new Map<string, AgentUsageLimitRow>();
  for (const line of rawOutput.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    const row = parseLimitLine(line);
    if (!row) continue;
    const existing = rowsById.get(row.id);
    if (!existing || row.sourceLine!.length > existing.sourceLine!.length) rowsById.set(row.id, row);
  }
  return [...rowsById.values()].sort((a, b) => limitSortKey(a) - limitSortKey(b) || a.label.localeCompare(b.label));
}

export function serializeAgentUsageLimitMessage(payload: AgentUsageLimitPayload): string {
  return `${USAGE_LIMIT_MESSAGE_PREFIX}\n${JSON.stringify(payload)}`;
}

export function parseAgentUsageLimitMessage(content: string): AgentUsageLimitPayload | null {
  if (!content.startsWith(`${USAGE_LIMIT_MESSAGE_PREFIX}\n`)) return null;
  try {
    const parsed = JSON.parse(content.slice(USAGE_LIMIT_MESSAGE_PREFIX.length + 1)) as AgentUsageLimitPayload;
    if (parsed?.kind !== 'agent-usage-limits' || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}
