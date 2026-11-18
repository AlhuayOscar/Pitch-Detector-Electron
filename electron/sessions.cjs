const { ipcMain, shell } = require('electron');
const { randomUUID } = require('node:crypto');
const { lstat, mkdir, open, readdir, realpath, rename, unlink } = require('node:fs/promises');
const path = require('node:path');

const channel = 'pitch-sessions:';
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const checkpointPattern = /^events-\d{10}\.json$/;
const webmPattern = /^audio\/webm(?:;\s*codecs=opus)?$/i;
const maxAudioChunk = 8 * 1024 * 1024;
const maxCheckpointEvents = 10_000;
const maxCheckpointBytes = 8 * 1024 * 1024;
const closeTimeout = 8_000;

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' &&
    !relative.startsWith('..' + path.sep));
}

function isLocal(directory) {
  return path.isAbsolute(directory) && (process.platform !== 'win32' || !directory.startsWith('\\\\'));
}

async function writableRoot(app) {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const portableParent = portableDir && path.basename(portableDir).toLowerCase() === 'release'
    ? path.dirname(portableDir)
    : portableDir;
  const projectDir = portableParent || (!app.isPackaged && app.getAppPath());
  const protectedDirs = [
    process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.SystemRoot,
  ].filter(Boolean);
  const eligible = (dir) => isLocal(dir) && !protectedDirs.some((root) => inside(root, dir));
  const candidates = [
    projectDir && path.join(projectDir, 'Sesiones'),
    path.join(app.getPath('documents'), 'Pitch Detector', 'Sesiones'),
  ].filter(Boolean);

  for (const directory of candidates) {
    if (!eligible(directory)) continue;
    try {
      await mkdir(directory, { recursive: true });
      if (!(await lstat(directory)).isDirectory()) continue;

      const canonical = await realpath(directory);
      if (!eligible(canonical)) continue;

      const probePath = path.join(canonical, '.write-test-' + randomUUID());
      const probe = await open(probePath, 'wx');
      await probe.close();
      await unlink(probePath);
      return canonical;
    } catch (error) {
      console.warn('No se pudo usar la carpeta de sesiones.', error);
    }
  }

  throw new Error('No se pudo abrir una carpeta local para guardar las sesiones.');
}

async function isSameDirectory(directory) {
  try {
    return (await lstat(directory)).isDirectory() &&
      path.relative(directory, await realpath(directory)) === '';
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function writeJson(directory, name, value) {
  const temporary = path.join(directory, '.tmp-' + randomUUID());
  const file = await open(temporary, 'wx');
  try {
    try {
      await file.writeFile(JSON.stringify(value) + '\n', 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path.join(directory, name));
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readJson(file, maxBytes) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > maxBytes) throw new Error('Archivo de sesión no válido.');
  const handle = await open(file, 'r');
  try {
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

async function audioInfo(directory) {
  const file = path.join(directory, 'audio.webm');
  try {
    const info = await lstat(file);
    return info.isFile() && info.size > 0 ? file : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function appendAudio(directory, bytes) {
  const file = path.join(directory, 'audio.webm');
  const existing = await lstat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing && !existing.isFile()) throw new Error('Archivo de audio no válido.');

  const handle = await open(file, 'a');
  try {
    const { size } = await handle.stat();
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.truncate(size).catch(() => {});
      throw error;
    }
  } finally {
    await handle.close();
  }
}

function validTime(value) {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function optionalText(value, maxLength) {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function validateCheckpoint(data, finished) {
  const { events, summary } = data ?? {};
  if (typeof finished !== 'boolean' || !Array.isArray(events) || events.length > maxCheckpointEvents ||
    !summary || !validTime(summary.durationMs) || !optionalText(summary.range, 100) ||
    !optionalText(summary.key, 100)) {
    throw new Error('Resumen de sesión no válido.');
  }

  const validatedEvents = events.map((event) => {
    const { atMs, source, midi, action, instrument, confidence } = event ?? {};
    if (!validTime(atMs) || !['voice', 'instrument'].includes(source) ||
      !Number.isFinite(midi) || midi < 0 || midi > 127 ||
      (source === 'instrument' && !Number.isInteger(midi)) ||
      (action !== undefined && action !== 'on' && action !== 'off') ||
      !optionalText(instrument, 128) ||
      (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))) {
      throw new Error('Evento de nota no válido.');
    }
    return { atMs, source, midi, action, instrument, confidence };
  });
  return {
    events: validatedEvents,
    summary: { durationMs: summary.durationMs, range: summary.range, key: summary.key },
    finished,
  };
}

function isTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

async function sessionOverview(directory, id) {
  const session = await readJson(path.join(directory, 'session.json'), 4096);
  if (session.id !== id || !isTimestamp(session.startedAt)) return null;
  const audio = await audioInfo(directory);
  const checkpoints = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && checkpointPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const name of checkpoints) {
    try {
      const saved = await readJson(path.join(directory, name), maxCheckpointBytes);
      if (isTimestamp(saved.savedAt) && typeof saved.finished === 'boolean') {
        return { id, startedAt: session.startedAt, savedAt: saved.savedAt, finished: saved.finished, hasAudio: !!audio };
      }
    } catch {
      // An unreadable checkpoint leaves earlier committed checkpoints available.
    }
  }

  return { id, startedAt: session.startedAt, savedAt: session.startedAt, finished: false, hasAudio: !!audio };
}

function enqueue(state, operation) {
  const pending = state.pending.then(operation);
  state.pending = pending.catch(() => {});
  return pending;
}

async function recording(state, id) {
  const active = state.active;
  if (!active || active.id !== id) throw new Error('Esa grabación no está activa.');
  if (!await isSameDirectory(active.directory)) throw new Error('La carpeta de la grabación ya no está disponible.');
  return active;
}

function registerPitchSessions(app, entryUrl) {
  const windows = new Map();
  let rootPromise;

  async function getRoot() {
    rootPromise ??= writableRoot(app).catch((error) => {
      rootPromise = undefined;
      throw error;
    });
    const directory = await rootPromise;
    if (await isSameDirectory(directory)) return directory;
    rootPromise = undefined;
    throw new Error('La carpeta de sesiones ya no está disponible.');
  }

  function trustedState(event) {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || frame.url !== entryUrl) return undefined;
    return windows.get(event.sender.id);
  }

  function handle(name, action) {
    ipcMain.handle(channel + name, (event, ...args) => {
      const state = trustedState(event);
      if (!state) throw new Error('Acceso a las sesiones denegado.');
      return action(state, ...args);
    });
  }

  handle('begin', (state, mimeType) => {
    if (typeof mimeType !== 'string' || mimeType.length > 64 || !webmPattern.test(mimeType)) {
      throw new Error('La grabación requiere audio WebM.');
    }
    if (state.active || state.beginning || state.finishClose) {
      throw new Error('Ya hay una grabación en curso.');
    }

    state.beginning = true;
    return enqueue(state, async () => {
      try {
        const id = randomUUID();
        const startedAt = new Date().toISOString();
        const root = await getRoot();
        const directory = path.join(root, id);
        await mkdir(directory);
        await writeJson(directory, 'session.json', { id, startedAt, mimeType });
        state.active = { id, directory, checkpoint: 0 };
        return { id, startedAt };
      } finally {
        state.beginning = false;
      }
    });
  });

  handle('append-audio', (state, id, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxAudioChunk) {
      throw new Error('Bloque de audio de sesión no válido.');
    }
    return enqueue(state, async () => appendAudio((await recording(state, id)).directory, bytes));
  });

  handle('checkpoint', (state, id, data, finished = false) => {
    const validated = validateCheckpoint(data, finished);
    return enqueue(state, async () => {
      const active = await recording(state, id);
      const number = active.checkpoint + 1;
      const name = 'events-' + String(number).padStart(10, '0') + '.json';
      const savedAt = new Date().toISOString();
      try {
        await writeJson(active.directory, name, { savedAt, ...validated });
        active.checkpoint = number;
        return savedAt;
      } finally {
        if (finished) state.active = null;
      }
    });
  });

  handle('list', async () => {
    const root = await getRoot();
    const sessions = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !sessionIdPattern.test(entry.name)) continue;
      try {
        const directory = path.join(root, entry.name);
        if (!await isSameDirectory(directory)) continue;
        const overview = await sessionOverview(directory, entry.name);
        if (overview) sessions.push(overview);
      } catch {
        // A damaged session should not prevent access to the rest of the library.
      }
    }
    return sessions.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  handle('play', async (_state, id) => {
    if (typeof id !== 'string' || !sessionIdPattern.test(id)) return 'Sesión no válida.';
    try {
      const directory = path.join(await getRoot(), id);
      const audio = await isSameDirectory(directory) && await audioInfo(directory);
      return audio ? await shell.openPath(audio) : 'La sesión no tiene audio guardado.';
    } catch (error) {
      console.error('No se pudo abrir el audio de la sesión.', error);
      return 'No se pudo abrir el audio de la sesión.';
    }
  });

  handle('show-folder', async () => {
    try {
      return await shell.openPath(await getRoot());
    } catch (error) {
      console.error('No se pudo abrir la carpeta de sesiones.', error);
      return 'No se pudo abrir la carpeta de sesiones.';
    }
  });

  ipcMain.on(channel + 'flushed', (event) => {
    const state = trustedState(event);
    if (state?.finishClose) void state.pending.then(state.finishClose);
  });

  function guardWindow(window) {
    const id = window.webContents.id;
    const state = { pending: Promise.resolve(), active: null, beginning: false, allowClose: false };
    windows.set(id, state);

    window.on('close', (event) => {
      if (state.allowClose || (!state.active && !state.beginning && !state.finishClose)) return;
      event.preventDefault();
      if (state.finishClose) return;

      const finish = () => {
        clearTimeout(state.timer);
        if (!state.finishClose) return;
        state.finishClose = null;
        state.allowClose = true;
        if (!window.isDestroyed()) window.close();
      };
      state.finishClose = finish;
      state.timer = setTimeout(finish, closeTimeout);
      try {
        window.webContents.send(channel + 'flush');
      } catch {
        void state.pending.then(finish);
      }
    });

    window.once('closed', () => {
      clearTimeout(state.timer);
      state.finishClose = null;
      windows.delete(id);
    });
  }

  return guardWindow;
}

module.exports = { registerPitchSessions };
