const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const { constants } = require('node:fs');
const { access, mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const releaseUrl = 'https://github.com/Anjok07/ultimatevocalremovergui/releases/tag/v5.6';
const executableNames = ['uvr.exe', 'ultimate vocal remover.exe', 'ultimate vocal remover v5.exe'];

async function canRead(file) {
  try {
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function knownExecutable(file) {
  return typeof file === 'string' && path.isAbsolute(file) &&
    executableNames.includes(path.basename(file).toLowerCase()) && await canRead(file);
}

function registerVocalRemover(app, entryUrl) {
  const configFile = path.join(app.getPath('userData'), 'vocal-remover.json');
  let running = null;
  let launchPending = null;

  async function savedExecutable() {
    try {
      const { executable } = JSON.parse(await readFile(configFile, 'utf8'));
      return await knownExecutable(executable) ? executable : null;
    } catch {
      return null;
    }
  }

  async function resolveRuntime() {
    const selected = await savedExecutable();
    if (selected) return { kind: 'installed', executable: selected, args: [], cwd: path.dirname(selected) };

    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    const roots = portableDir
      ? [portableDir, path.dirname(portableDir)]
      : [app.getAppPath()];

    for (const root of roots) {
      const runtime = path.join(root, '.uvr');
      const executable = path.join(runtime, 'venv', 'Scripts', 'pythonw.exe');
      const script = path.join(runtime, 'ultimatevocalremovergui', 'UVR.py');
      if (await canRead(path.join(runtime, 'ready.json')) && await canRead(executable) && await canRead(script)) {
        return { kind: 'prepared', executable, args: [script], cwd: path.dirname(script) };
      }
    }

    const programFolders = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    ].filter(Boolean);
    for (const parent of programFolders) {
      for (const directory of ['Ultimate Vocal Remover', 'Ultimate Vocal Remover v5']) {
        const cwd = path.join(parent, directory);
        for (const name of executableNames) {
          const executable = path.join(cwd, name);
          if (await canRead(executable)) return { kind: 'installed', executable, args: [], cwd };
        }
      }
    }

    return null;
  }

  function handle(channel, action) {
    ipcMain.handle('uvr:' + channel, async (event) => {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame || frame.url !== entryUrl) {
        throw new Error('Acceso a VocalRemover denegado.');
      }
      return action(event);
    });
  }

  async function launch() {
    if (running) return 'already-open';
    const runtime = await resolveRuntime();
    if (!runtime) return 'unavailable';

    return new Promise((resolve) => {
      const child = spawn(runtime.executable, runtime.args, {
        cwd: runtime.cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      running = child;
      child.once('spawn', () => {
        child.unref();
        resolve('opened');
      });
      child.once('error', (error) => {
        if (running === child) running = null;
        console.error('Error al abrir Ultimate Vocal Remover.', error);
        resolve('error');
      });
      child.once('exit', () => {
        if (running === child) running = null;
      });
    });
  }

  handle('status', async () => (await resolveRuntime())?.kind ?? 'unavailable');
  handle('launch', () => {
    if (!launchPending) {
      launchPending = launch().finally(() => { launchPending = null; });
    }
    return launchPending;
  });
  handle('locate', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return 'error';

    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Seleccionar Ultimate Vocal Remover',
      properties: ['openFile'],
      filters: [{ name: 'Ejecutable de Ultimate Vocal Remover', extensions: ['exe'] }],
    });
    if (canceled) return 'cancelled';

    const executable = filePaths[0];
    if (!await knownExecutable(executable)) return 'invalid';
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, JSON.stringify({ executable }), 'utf8');
    return 'selected';
  });
  handle('download', () => shell.openExternal(releaseUrl));
}

module.exports = { registerVocalRemover };
