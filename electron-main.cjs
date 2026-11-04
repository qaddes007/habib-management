const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    try {
        autoUpdater = require(path.join(__dirname, 'frontend', 'node_modules', 'electron-updater')).autoUpdater;
    } catch (e2) {
        // Updater only needed in production packaged app
    }
}


// Disable HTTP cache completely so updates and asset changes are always live
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow = null;
let phpProcess = null;
let appApiToken = null;

const PORT = 8080;
const DEFAULT_SERVER_URL = `http://127.0.0.1:${PORT}`;
const XAMPP_ROOT = process.env.XAMPP_HOME || 'C:\\xampp';
const PHP_EXE = path.join(XAMPP_ROOT, 'php', 'php.exe');
const MYSQLD_EXE = path.join(XAMPP_ROOT, 'mysql', 'bin', 'mysqld.exe');
const MYSQL_INI = path.join(XAMPP_ROOT, 'mysql', 'bin', 'my.ini');

// Resolve resources directory for both unpacked (development) and packaged (production) builds
const isPackaged = app.isPackaged;
const resourcesDir = isPackaged ? process.resourcesPath : __dirname;
const ROUTER_PATH = path.join(resourcesDir, 'backend', 'router.php');
const BACKEND_CWD = path.join(resourcesDir, 'backend');
const ICON_PATH = path.join(resourcesDir, 'assets', 'app-icon.ico');
const FRONTEND_DIST = path.join(resourcesDir, 'frontend', 'dist');

// ============================================================
// 1. Automatic Database Backup Routine (Safe Updates)
// ============================================================
function backupClientData() {
    try {
        const fs = require('fs');
        const backupDir = path.join(app.getPath('userData'), 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `habib_management_backup_${timestamp}.sql`);
        const mysqldumpPath = 'C:\\xampp\\mysql\\bin\\mysqldump.exe';

        if (fs.existsSync(mysqldumpPath)) {
            const { exec } = require('child_process');
            exec(`"${mysqldumpPath}" -u root --databases habib_management -r "${backupFile}"`, (err) => {
                if (err) {
                    console.warn('[Backup] mysqldump notice:', err.message);
                } else {
                    console.log('[Backup] Client database snapshot created:', backupFile);
                }
            });
        }
    } catch (err) {
        console.warn('[Backup] Backup routine notice:', err.message);
    }
}

// ============================================================
// 2. Check if MySQL is running on port 3306; start it if not
// ============================================================
function ensureMySQL() {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let settled = false;
        const finish = (error, available = false) => {
            if (settled) return;
            settled = true;
            client.destroy();
            if (error) reject(error);
            else resolve(available);
        };
        client.setTimeout(1000);
        client.on('connect', () => {
            finish(null, true);
        });
        client.on('error', () => {
            if (settled) return;
            client.destroy();
            if (!fs.existsSync(MYSQLD_EXE) || !fs.existsSync(MYSQL_INI)) {
                finish(new Error(
                    `MySQL is not running and XAMPP was not found at "${XAMPP_ROOT}". ` +
                    'Install XAMPP or set XAMPP_HOME, then start MySQL.'
                ));
                return;
            }

            try {
                const myProc = spawn(MYSQLD_EXE, [
                    `--defaults-file=${MYSQL_INI}`,
                    '--standalone'
                ], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                });
                myProc.unref();
                myProc.once('error', err => finish(new Error(`Could not start MySQL: ${err.message}`)));
            } catch (err) {
                finish(new Error(`Could not start MySQL: ${err.message}`));
                return;
            }

            const deadline = Date.now() + 30000;
            const poll = () => {
                if (settled) return;
                const check = new net.Socket();
                check.setTimeout(1000);
                let retrying = false;
                check.once('connect', () => {
                    check.destroy();
                    finish(null, true);
                });
                const retry = () => {
                    if (retrying) return;
                    retrying = true;
                    check.destroy();
                    if (Date.now() >= deadline) {
                        finish(new Error('MySQL did not start within 30 seconds. Check the XAMPP MySQL logs.'));
                    } else {
                        setTimeout(poll, 500);
                    }
                };
                check.once('error', retry);
                check.once('timeout', retry);
                check.connect(3306, '127.0.0.1');
            };
            setTimeout(poll, 500);
        });
        client.on('timeout', () => {
            finish(new Error('Timed out while checking whether MySQL is running.'));
        });
        client.connect(3306, '127.0.0.1');
    });
}

// ============================================================
// 3. Start PHP backend built-in server on port 8080
// ============================================================
function loadApiToken() {
    const tokenPath = path.join(app.getPath('userData'), 'api-token');
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });

    try {
        const token = fs.readFileSync(tokenPath, 'utf8').trim();
        if (/^[a-f0-9]{64}$/.test(token)) return token;
        throw new Error('The saved local API token is invalid.');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    const token = crypto.randomBytes(32).toString('hex');
    try {
        fs.writeFileSync(tokenPath, token, { flag: 'wx', mode: 0o600 });
        return token;
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const existingToken = fs.readFileSync(tokenPath, 'utf8').trim();
        if (/^[a-f0-9]{64}$/.test(existingToken)) return existingToken;
        throw new Error('The saved local API token is invalid.');
    }
}

function requestHealth(baseUrl, token) {
    return new Promise(resolve => {
        const req = http.get(`${baseUrl}/api/health`, {
            headers: { 'X-App-Token': token }
        }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try {
                    const health = JSON.parse(body);
                    const running = res.statusCode === 200 &&
                        health.ok === true &&
                        health.app === 'S. HABIB Management API';
                    resolve({
                        running,
                        authenticated: running && health.authenticated === true
                    });
                } catch {
                    resolve({ running: false, authenticated: false });
                }
            });
        });
        req.setTimeout(3000, () => req.destroy());
        req.on('error', () => resolve({ running: false, authenticated: false }));
    });
}

function startPHP() {
    return (async () => {
        appApiToken = loadApiToken();
        const existingServer = await requestHealth(DEFAULT_SERVER_URL, appApiToken);
        if (existingServer.authenticated) return;
        if (existingServer.running) {
            throw new Error('An unauthenticated PHP server is already using port 8080. Stop it and restart the app.');
        }

        if (!fs.existsSync(PHP_EXE)) {
            throw new Error(
                `PHP was not found at "${PHP_EXE}". ` +
                'Install XAMPP or set XAMPP_HOME.'
            );
        }
        if (!fs.existsSync(ROUTER_PATH) || !fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
            throw new Error('The application files are incomplete. Reinstall the application using its installer.');
        }

        phpProcess = spawn(PHP_EXE, [
            '-S', `127.0.0.1:${PORT}`,
            ROUTER_PATH
        ], {
            cwd: BACKEND_CWD,
            stdio: 'ignore',
            windowsHide: true,
            env: {
                ...process.env,
                FRONTEND_DIST: FRONTEND_DIST,
                APP_API_TOKEN: appApiToken
            }
        });

        let phpSpawnError = null;
        phpProcess.once('error', err => { phpSpawnError = err; });
        phpProcess.once('exit', code => {
            if (code !== null) phpSpawnError = new Error(`PHP server stopped during startup (exit code ${code}).`);
        });
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            const health = await requestHealth(DEFAULT_SERVER_URL, appApiToken);
            if (health.authenticated) return;
            if (health.running) {
                phpProcess.kill();
                throw new Error('An unauthenticated PHP server is already using port 8080. Stop it and restart the app.');
            }
            await new Promise(resolve => setTimeout(resolve, 300));
            if (phpSpawnError) {
                throw new Error(`Could not start PHP: ${phpSpawnError.message}`);
            }
            if (phpProcess.exitCode !== null) {
                throw new Error(`PHP server stopped during startup (exit code ${phpProcess.exitCode}).`);
            }
        }
        phpProcess.kill();
        throw new Error('PHP server did not become ready within 15 seconds. Check the XAMPP PHP installation.');
    })();
}

// ============================================================
// 4. Create the Main Application Window
// ============================================================
function createWindow() {
    const appVersion = app.getVersion();
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: `S. HABIB STEEL & LASER CRAFT - v${appVersion}`,
        icon: ICON_PATH,
        autoHideMenuBar: true,
        backgroundColor: '#000B18',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            additionalArguments: [`--app-api-token=${appApiToken}`],
            cache: false
        }
    });

    // Clear session cache on launch so updates are always instant
    if (mainWindow.webContents.session) {
        mainWindow.webContents.session.clearCache();
    }

    // Enable F5 / Ctrl+R reload without cache
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
            mainWindow.webContents.reloadIgnoringCache();
        }
    });

    mainWindow.maximize();
    mainWindow.loadURL(DEFAULT_SERVER_URL);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ============================================================
// 5. Silent Auto-Updater (electron-updater + GitHub Releases)
// ============================================================
function initAutoUpdater() {
    if (!autoUpdater || !app.isPackaged) {
        console.log('[AutoUpdater] Packaged build or updater not active; skipping auto-update checks.');
        return;
    }


    // Silent background downloading & auto-install on quit
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Fail silently on errors (e.g. offline, no internet, repo unreachable)
    autoUpdater.on('error', (err) => {
        console.warn('[AutoUpdater] Update check/download notice (silent):', err ? err.message : 'Unknown');
    });

    autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdater] Checking for updates on GitHub Releases...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log(`[AutoUpdater] New update found (v${info.version}). Downloading silently in background...`);
    });

    autoUpdater.on('update-not-available', () => {
        console.log('[AutoUpdater] Current version is up-to-date.');
    });

    // When the update download is completed, notify user with non-intrusive dialog
    autoUpdater.on('update-downloaded', (info) => {
        console.log(`[AutoUpdater] Update downloaded: v${info.version}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Naya Update Tayyar Hai',
                message: `S. HABIB STEEL & LASER CRAFT ka naya version (v${info.version}) download ho chuka hai.`,
                detail: 'Kya aap abhi software restart karna chahte hain? Agar aap "Baad Mein" chunenge to jab bhi aap software band karenge, naya version khud ba khud install ho jayega.',
                buttons: ['Abhi Restart Karen', 'Baad Mein'],
                defaultId: 0,
                cancelId: 1,
                noLink: true
            }).then((result) => {
                if (result.response === 0) {
                    backupClientData();
                    autoUpdater.quitAndInstall(false, true);
                }
            }).catch(() => {});
        }
    });

    // Check 5 seconds after startup (non-blocking)
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 5000);

    // Re-check periodically every 30 minutes in background
    setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 30 * 60 * 1000);
}

// ============================================================
// 6. Ensure Desktop Shortcut for standalone / portable runs
// ============================================================
function ensureDesktopShortcut() {
    if (process.platform !== 'win32') return;

    try {
        const shortcutPath = path.join(app.getPath('desktop'), 'S. HABIB STEEL.lnk');
        const appPath = app.getAppPath();
        const executablePath = app.getPath('exe');
        const shortcutCreated = shell.writeShortcutLink(shortcutPath, 'replace', {
            target: executablePath,
            args: app.isPackaged ? '' : `"${appPath}"`,
            cwd: app.isPackaged ? path.dirname(executablePath) : appPath,
            description: 'S. HABIB STEEL & LASER CRAFT Management System',
            icon: ICON_PATH,
            iconIndex: 0
        });

        if (!shortcutCreated) {
            console.warn(`[Shortcut] Could not create or update desktop shortcut at "${shortcutPath}".`);
        }
    } catch (err) {
        console.warn('[Shortcut] Could not repair the desktop shortcut:', err);
    }
}

// ============================================================
// 7. App Lifecycle
// ============================================================
app.whenReady().then(async () => {
    try {
        ensureDesktopShortcut();
        await ensureMySQL();
        await startPHP();
        createWindow();
        initAutoUpdater();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    } catch (err) {
        console.error('[Startup] Application could not start:', err);
        dialog.showErrorBox(
            'S. HABIB STEEL & LASER CRAFT could not start',
            `${err.message}\n\nInstall/start XAMPP with PHP and MySQL, then launch the app again.`
        );
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (phpProcess && phpProcess.pid) {
        try {
            require('child_process').exec(`taskkill /F /PID ${phpProcess.pid} /T`, () => {});
        } catch (e) {}
    }
    app.quit();
});
