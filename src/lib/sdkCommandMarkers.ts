export const SDK_COMMAND_EXIT_MARKER = '__COMET_COMMAND_EXIT';

export type SdkTerminalPlatform = 'windows' | 'posix';
export type SdkTerminalCommandLanguage = 'bash' | 'cmd' | 'powershell' | string;

export function detectSdkTerminalPlatform(userAgent: string = globalThis.navigator?.userAgent ?? ''): SdkTerminalPlatform {
  return /\bWindows\b/i.test(userAgent) ? 'windows' : 'posix';
}

export function formatSdkTerminalRunCommand(command: string, platform: SdkTerminalPlatform, language?: SdkTerminalCommandLanguage): string {
  const trimmed = command.trim();
  if (!trimmed || trimmed.includes(SDK_COMMAND_EXIT_MARKER)) return trimmed;
  const runnable = platform === 'windows' && isSdkPowerShellLanguage(language)
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodeSdkPowerShellCommand(trimmed)}`
    : trimmed;
  return platform === 'windows'
    ? `${runnable} & call echo ${SDK_COMMAND_EXIT_MARKER}:%^ERRORLEVEL%`
    : `${runnable}; printf '\\n${SDK_COMMAND_EXIT_MARKER}:%s\\n' "$?"`;
}

export function isSdkPowerShellLanguage(language?: SdkTerminalCommandLanguage): boolean {
  const normalized = language?.trim().toLowerCase();
  return normalized === 'powershell' || normalized === 'pwsh' || normalized === 'ps1';
}

export function encodeSdkPowerShellCommand(command: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < command.length; index += 1) {
    const code = command.charCodeAt(index);
    bytes.push(code & 0xff, (code >> 8) & 0xff);
  }
  return encodeSdkBase64(bytes);
}

function encodeSdkBase64(bytes: number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    out += alphabet[(combined >> 18) & 63];
    out += alphabet[(combined >> 12) & 63];
    out += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : '=';
    out += index + 2 < bytes.length ? alphabet[combined & 63] : '=';
  }
  return out;
}
