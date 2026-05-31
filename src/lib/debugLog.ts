type DebugEnv = Record<string, string | boolean | undefined>;

function readImportMetaEnv(): DebugEnv | undefined {
  return (import.meta as ImportMeta & { env?: DebugEnv }).env;
}

function isEnabledFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

export function isDebugScopeEnabled(scope: string, envKey?: string): boolean {
  const env = readImportMetaEnv();
  let debugEnabled = isEnabledFlag(env?.DEV) || (envKey ? isEnabledFlag(env?.[envKey]) : false);

  try {
    debugEnabled = debugEnabled || window.localStorage.getItem(`comet.debug.${scope}`) === '1';
  } catch {
    // Ignore storage access failures in restricted webviews.
  }

  return debugEnabled;
}

export function scopedDebugLog(scope: string, envKey: string | undefined, ...args: unknown[]): void {
  if (isDebugScopeEnabled(scope, envKey)) console.debug(...args);
}
