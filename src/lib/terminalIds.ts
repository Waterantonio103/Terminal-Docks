const ANSI_ESCAPE_PATTERN = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;
const MAX_TERMINAL_ID_LENGTH = 128;

export function normalizeTerminalId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const terminalId = value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/[\s\x00-\x1F\x7F]/g, '');
  return terminalId && terminalId.length <= MAX_TERMINAL_ID_LENGTH ? terminalId : null;
}
