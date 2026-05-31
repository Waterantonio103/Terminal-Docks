export type McpJsonResponse = Record<string, unknown>;

function isRecord(value: unknown): value is McpJsonResponse {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(raw: string, emptyFallback: McpJsonResponse, errorPrefix: string): McpJsonResponse {
  const trimmed = raw.trim();
  if (!trimmed) return emptyFallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(trimmed ? `${errorPrefix}: ${trimmed}` : errorPrefix);
  }
  if (!isRecord(parsed)) throw new Error(`${errorPrefix}: expected a JSON object`);
  return parsed;
}

function firstSseDataPayload(raw: string): string | null {
  const events = raw.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .map(line => line.trimStart())
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    return data;
  }
  return null;
}

export async function readMcpJsonResponse(response: Response): Promise<McpJsonResponse> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const rawBody = await response.text();
  const failureMessage = `Starlink request failed: HTTP ${response.status}`;

  if (contentType.includes('text/event-stream')) {
    const data = firstSseDataPayload(rawBody);
    if (!data) return {};
    return parseJsonObject(data, {}, response.ok ? 'Starlink returned a non-JSON event-stream response' : failureMessage);
  }

  try {
    return parseJsonObject(rawBody, {}, response.ok ? 'Starlink returned a non-JSON response' : failureMessage);
  } catch (error) {
    if (!response.ok && rawBody.trim()) throw new Error(rawBody.trim());
    throw error;
  }
}
