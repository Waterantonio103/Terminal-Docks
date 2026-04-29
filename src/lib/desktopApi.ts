// Wrapper for desktop API, replacing Tauri
export async function invoke<T>(cmd: string, payload?: any): Promise<T> {
  // @ts-ignore
  if (window.desktopApi) {
    // @ts-ignore
    return window.desktopApi.invoke(cmd, payload);
  }
  
  console.warn(`Desktop API not available. Cannot invoke: ${cmd}`);
  return null as any;
}

export async function listen<T>(event: string, cb: (event: { payload: T, event: string }) => void) {
  // @ts-ignore
  if (window.desktopApi) {
    // @ts-ignore
    return window.desktopApi.on(event, (payload: T) => cb({ payload, event }));
  }
  return () => {};
}

export async function emit(event: string, payload?: any) {
  // @ts-ignore
  if (window.desktopApi) {
    // @ts-ignore
    return window.desktopApi.emit(event, payload);
  }
}

// Mock for @tauri-apps/api/path
export async function homeDir(): Promise<string> {
  return invoke<string>('get_home_dir');
}

// Mock for @tauri-apps/api/window
export const Window = {
  getCurrent: () => ({
    minimize: () => invoke('window_minimize'),
    toggleMaximize: () => invoke('window_toggle_maximize'),
    close: () => invoke('window_close')
  })
};

// Mock for @tauri-apps/plugin-clipboard-manager
export async function writeText(text: string): Promise<void> {
  return invoke('write_clipboard', { text });
}

export async function readText(): Promise<string> {
  return invoke<string>('read_clipboard');
}

// Mock for @tauri-apps/plugin-dialog
export async function open(options?: any): Promise<string | string[] | null> {
  return invoke<string | string[] | null>('dialog_open', { options });
}

// Mock for @tauri-apps/plugin-opener
export async function openUrl(url: string): Promise<void> {
  return invoke('open_url', { url });
}
