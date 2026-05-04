import { contextBridge, ipcRenderer } from 'electron';

console.log('Preload script loading...');

contextBridge.exposeInMainWorld('desktopApi', {
  invoke: (cmd: string, payload?: any) => ipcRenderer.invoke('invoke', cmd, payload),
  on: (event: string, cb: (data: any) => void) => {
    const listener = (_: any, payload: any) => cb(payload);
    ipcRenderer.on('backend-event', (e, eventName, payload) => {
      if (eventName === event) {
        listener(e, payload);
      }
    });
    
    return () => {
      // In a real implementation we would map this properly
    };
  },
  emit: (event: string, payload?: any) => ipcRenderer.invoke('invoke', 'emit_event', { event, payload })
});
