import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktopApi', {
    invoke: (cmd, payload) => ipcRenderer.invoke('invoke', cmd, payload),
    on: (event, cb) => {
        const listener = (_, payload) => cb(payload);
        ipcRenderer.on('backend-event', (e, eventName, payload) => {
            if (eventName === event) {
                listener(e, payload);
            }
        });
        return () => {
            // In a real implementation we would map this properly
        };
    },
    emit: (event, payload) => ipcRenderer.invoke('invoke', 'emit_event', { event, payload })
});
