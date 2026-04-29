import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let backendProcess = null;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
        // Assuming Vite dev server runs on 1420
        mainWindow.loadURL('http://localhost:1420');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function startBackend() {
    // In dev mode, we could run the cargo binary directly
    // In prod mode, we would run the bundled sidecar
    const backendPath = app.isPackaged
        ? path.join(process.resourcesPath, 'backend')
        : path.join(__dirname, '../backend/target/debug/backend');
    backendProcess = spawn(backendPath, [], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    backendProcess.stdout?.on('data', (data) => {
        try {
            const messages = data.toString().trim().split('\n');
            for (const msg of messages) {
                if (!msg)
                    continue;
                const parsed = JSON.parse(msg);
                if (parsed.type === 'event' && mainWindow) {
                    mainWindow.webContents.send('backend-event', parsed.event, parsed.payload);
                }
                else if (parsed.type === 'response') {
                    // Send response back to the specific invoke request
                    mainWindow?.webContents.send(`response-${parsed.id}`, parsed.payload, parsed.error);
                }
            }
        }
        catch (e) {
            console.error('Failed to parse backend output:', data.toString());
        }
    });
    backendProcess.stderr?.on('data', (data) => {
        console.error(`Backend error: ${data}`);
    });
    backendProcess.on('exit', (code) => {
        console.log(`Backend process exited with code ${code}`);
    });
}
app.whenReady().then(() => {
    startBackend();
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('before-quit', () => {
    if (backendProcess) {
        backendProcess.kill();
    }
});
// IPC handler for invoke calls
ipcMain.handle('invoke', async (event, cmd, payload) => {
    return new Promise((resolve, reject) => {
        const id = Date.now().toString() + Math.random().toString();
        // Set up one-time listener for the response
        ipcMain.once(`response-${id}`, (_, responsePayload, error) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(responsePayload);
            }
        });
        // Send request to backend
        if (backendProcess && backendProcess.stdin) {
            const request = JSON.stringify({ id, cmd, payload }) + '\n';
            backendProcess.stdin.write(request);
        }
        else {
            reject(new Error('Backend process not running'));
        }
    });
});
