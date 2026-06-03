const ANSI_RE =
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

type ContextMatch = {
  index: number;
  kind: 'used' | 'left';
  value: number;
};

export interface CodexContextUsage {
  usedPercent: number;
  usedTokens?: number;
  totalTokens?: number;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseTokenCount(value: string, suffix: string | undefined): number | null {
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return null;
  const multiplier = suffix?.toLowerCase() === 'm' ? 1_000_000 : suffix?.toLowerCase() === 'k' ? 1_000 : 1;
  return Math.round(parsed * multiplier);
}

function stripTerminalControls(value: string): string {
  return value
    .replace(ANSI_RE, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '');
}

function pushMatch(matches: ContextMatch[], index: number, rawValue: string, rawKind: string): void {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  const kind = rawKind.toLowerCase() === 'left' ? 'left' : 'used';
  matches.push({ index, kind, value: clampPercent(value) });
}

export function parseCodexContextUsage(output: string): CodexContextUsage | null {
  const clean = stripTerminalControls(output);
  const matches: ContextMatch[] = [];
  const tokenMatches: Array<{ index: number; usedTokens: number; totalTokens: number }> = [];

  const tokenPairRe = /\bContext\b[^0-9\n\r]{0,24}(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmM])?\s*(?:\/|of)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmM])?\s*tokens?\b/gi;
  let tokenPairMatch: RegExpExecArray | null;
  while ((tokenPairMatch = tokenPairRe.exec(clean)) !== null) {
    const usedTokens = parseTokenCount(tokenPairMatch[1], tokenPairMatch[2]);
    const totalTokens = parseTokenCount(tokenPairMatch[3], tokenPairMatch[4]);
    if (usedTokens !== null && totalTokens !== null && totalTokens > 0) {
      tokenMatches.push({ index: tokenPairMatch.index, usedTokens, totalTokens });
    }
  }

  const contextValueFirstRe = /\bContext\s*:?\s*(\d{1,3})\s*%\s*(used|left)\b/gi;
  let valueFirstMatch: RegExpExecArray | null;
  while ((valueFirstMatch = contextValueFirstRe.exec(clean)) !== null) {
    pushMatch(matches, valueFirstMatch.index, valueFirstMatch[1], valueFirstMatch[2]);
  }

  const contextKindFirstRe = /\bContext\s+(used|left)\s*:?\s*(\d{1,3})\s*%/gi;
  let kindFirstMatch: RegExpExecArray | null;
  while ((kindFirstMatch = contextKindFirstRe.exec(clean)) !== null) {
    pushMatch(matches, kindFirstMatch.index, kindFirstMatch[2], kindFirstMatch[1]);
  }

  const percentContextRe = /\b(\d{1,3})\s*%\s+context\s+(used|left)\b/gi;
  let percentContextMatch: RegExpExecArray | null;
  while ((percentContextMatch = percentContextRe.exec(clean)) !== null) {
    pushMatch(matches, percentContextMatch.index, percentContextMatch[1], percentContextMatch[2]);
  }

  if (matches.length === 0 && tokenMatches.length === 0) return null;
  matches.sort((a, b) => a.index - b.index);
  tokenMatches.sort((a, b) => a.index - b.index);

  const latestTokenMatch = tokenMatches[tokenMatches.length - 1] ?? null;
  if (matches.length === 0 && latestTokenMatch) {
    return {
      usedPercent: clampPercent((latestTokenMatch.usedTokens / latestTokenMatch.totalTokens) * 100),
      usedTokens: latestTokenMatch.usedTokens,
      totalTokens: latestTokenMatch.totalTokens,
    };
  }

  const latest = matches[matches.length - 1];

  const footerWindowStart = latest.index - 180;
  const footerWindowEnd = latest.index + 180;
  const latestUsedInSameFooter = [...matches]
    .reverse()
    .find(match =>
      match.kind === 'used' &&
      match.index >= footerWindowStart &&
      match.index <= footerWindowEnd
    );
  const usedPercent = latestUsedInSameFooter
    ? latestUsedInSameFooter.value
    : latest.kind === 'used' ? latest.value : clampPercent(100 - latest.value);
  const nearbyTokenMatch = latestTokenMatch && Math.abs(latestTokenMatch.index - latest.index) <= 240
    ? latestTokenMatch
    : null;

  return {
    usedPercent,
    usedTokens: nearbyTokenMatch?.usedTokens,
    totalTokens: nearbyTokenMatch?.totalTokens,
  };
}

export function parseCodexContextUsagePercent(output: string): number | null {
  return parseCodexContextUsage(output)?.usedPercent ?? null;
}
