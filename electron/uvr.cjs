const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const { access, copyFile, mkdtemp, readFile, realpath, rmdir, stat, unlink } = require('node:fs/promises');
const readline = require('node:readline');
const path = require('node:path');

const runtimeCommit = 'a897c05a82b1d6bd5979911535cebe248315f5ae';
const modelName = 'UVR-MDX-NET-Inst_Main.onnx';
const windows = new Map();
const fileExtensions = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'mp4', 'mov', 'mkv', 'webm', 'aif', 'aiff', 'avi', 'wma', 'wmv', 'mpg', 'mpeg'];
const allowedFormats = 'wav,mp3,mov,flac,ogg,matroska,webm,aac,aiff,avi,asf,mpeg';

function cancelled() {
  return new Error('La separación se canceló.');
}

function localPath(file) {
  return typeof file === 'string' && path.isAbsolute(file) &&
    (process.platform !== 'win32' || !file.startsWith('\\\\'));
}

async function readableFile(file) {
  const resolved = await realpath(file);
  if (!localPath(resolved) || !(await stat(resolved)).isFile()) {
    throw new Error('El archivo debe estar disponible en este equipo.');
  }
  await access(resolved, constants.R_OK);
  return resolved;
}

async function runtimeFor(app, findFfmpeg) {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  const executableFolder = path.dirname(app.getPath('exe'));
  const roots = [
    ...(localPath(portable) ? [portable, path.dirname(portable)] : []),
    app.getAppPath(),
    executableFolder,
    path.dirname(executableFolder),
    path.dirname(path.dirname(executableFolder)),
  ];

  for (const root of new Set(roots.filter(localPath))) {
    const runtimeDir = path.join(root, '.uvr');
    const source = path.join(runtimeDir, 'ultimatevocalremovergui');
    let python;
    try {
      const manifestPath = await readableFile(path.join(runtimeDir, 'ready.json'));
      if ((await stat(manifestPath)).size > 4096) continue;
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.version !== '5.6.0' || manifest.commit !== runtimeCommit || manifest.modelName !== modelName) continue;
      python = await readableFile(path.join(runtimeDir, 'venv', 'Scripts', 'python.exe'));
      await readableFile(path.join(source, 'separate.py'));
      await readableFile(path.join(source, 'models', 'MDX_Net_Models', modelName));
    } catch {
      continue;
    }

    try {
      const ffmpeg = await readableFile(path.join(source, 'ffmpeg.exe'));
      return { python, ffmpeg, source: await realpath(source) };
    } catch {
      try {
        const { executable: ffmpeg } = await findFfmpeg(app);
        return { python, ffmpeg, source: await realpath(source) };
      } catch {
        return null;
      }
    }
  }

  return null;
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32' || !child.pid || !process.env.SystemRoot) {
    child.kill();
    return;
  }
  // The Windows venv interpreter can start a second Python process.
  const killer = spawn(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), [
    '/pid', String(child.pid), '/t', '/f',
  ], { windowsHide: true, stdio: 'ignore' });
  killer.once('error', () => child.kill());
  killer.once('exit', (code) => { if (code !== 0) child.kill(); });
}

function runProcess(executable, args, { signal, cwd, input, timeout, message, onLine }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: [input ? 'pipe' : 'ignore', onLine ? 'pipe' : 'ignore', 'pipe'],
    });
    let failure;
    let diagnostic = '';
    let lines;
    const stop = (error) => {
      failure ??= error;
      stopChild(child);
    };
    const abort = () => stop(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => stop(new Error('La separación local tardó demasiado.')), timeout);
    child.once('error', (error) => {
      failure ??= new Error(message, { cause: error });
    });
    child.stderr.on('data', (bytes) => {
      if (diagnostic.length < 2048) diagnostic += bytes.toString('utf8').slice(0, 2048 - diagnostic.length);
    });
    if (onLine) {
      lines = readline.createInterface({ input: child.stdout });
      lines.on('line', onLine);
    }
    if (input) {
      child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') stop(new Error(message)); });
      child.stdin.end(input);
    }
    child.once('close', (code) => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
      lines?.close();
      if (failure) {
        reject(failure);
      } else if (code !== 0) {
        if (diagnostic) console.warn('Motor de VocalRemover:', diagnostic.trim());
        reject(new Error(message));
      } else {
        resolve();
      }
    });
  });
}

function safeBaseName(input) {
  return path.basename(input, path.extname(input)).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 110).trim() || 'Audio';
}

async function writeOutputs(staged, directory, base, signal) {
  for (let choice = 1; choice <= 1000; choice++) {
    signal.throwIfAborted();
    const stem = choice === 1 ? base : base + ' (' + choice + ')';
    const vocals = path.join(directory, stem + ' - Voces.wav');
    const instrumental = path.join(directory, stem + ' - Instrumental.wav');
    const written = [];
    try {
      await copyFile(staged.vocals, vocals, constants.COPYFILE_EXCL);
      written.push(vocals);
      await copyFile(staged.instrumental, instrumental, constants.COPYFILE_EXCL);
      written.push(instrumental);
      signal.throwIfAborted();
      return { vocals, instrumental };
    } catch (error) {
      await Promise.all(written.map((file) => unlink(file)));
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('No se encontró un nombre disponible para las pistas WAV.');
}

async function separateFile(runtime, input, output, signal, sendProgress) {
  const script = await readFile(path.join(__dirname, 'uvr-separate.py'), 'utf8');
  signal.throwIfAborted();
  const working = await mkdtemp(path.join(output, '.uvr-work-'));
  const decoded = path.join(working, 'decoded.wav');
  const staged = { vocals: path.join(working, 'vocals.wav'), instrumental: path.join(working, 'instrumental.wav') };
  try {
    sendProgress({ percent: 3, message: 'Preparando el audio…' });
    await runProcess(runtime.ffmpeg, [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-protocol_whitelist', 'file', '-format_whitelist', allowedFormats,
      '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', '601',
      '-ac', '2', '-ar', '44100', '-c:a', 'pcm_f32le', decoded,
    ], { signal, timeout: 120_000, message: 'No se pudo leer una pista de audio del archivo.' });
    if ((await stat(decoded)).size > 44_100 * 600 * 2 * 4 + 4096) {
      throw new Error('La pista supera el límite de 10 minutos.');
    }

    await runProcess(runtime.python, [
      '-X', 'utf8', '-B', '-u', '-', runtime.source, decoded, staged.instrumental, staged.vocals,
    ], {
      signal, cwd: runtime.source, input: script, timeout: 1_800_000,
      message: 'UVR no pudo separar este audio. Probá con un archivo local válido de hasta 10 minutos.',
      onLine: (line) => {
        if (line.length > 512) return;
        try {
          const { percent, message } = JSON.parse(line);
          if (Number.isFinite(percent) && percent >= 0 && percent <= 100 && typeof message === 'string') {
            sendProgress({ percent, message });
          }
        } catch {
          // The upstream inference library may write diagnostic lines alongside progress.
        }
      },
    });
    if ((await stat(staged.vocals)).size <= 44 || (await stat(staged.instrumental)).size <= 44) {
      throw new Error('UVR no generó dos pistas WAV válidas.');
    }
    return await writeOutputs(staged, output, safeBaseName(input), signal);
  } finally {
    await Promise.allSettled([decoded, staged.vocals, staged.instrumental].map((file) => unlink(file)));
    await rmdir(working).catch(() => {});
  }
}

async function resolveVocalReference(sender, token) {
  const session = windows.get(sender.id);
  if (!session || typeof token !== 'string' || !session.result || session.result.token !== token) {
    throw new Error('No se encontró el resultado de voz de esta ventana.');
  }
  const file = await readableFile(session.result.vocals);
  if (file !== session.result.vocals) throw new Error('El resultado de voz ya no está disponible.');
  return file;
}

function registerVocalRemover(app, entryUrl, findFfmpeg) {
  function getState(sender) {
    let state = windows.get(sender.id);
    if (!state) {
      state = { input: null, output: null, result: null, job: null };
      windows.set(sender.id, state);
      sender.once('destroyed', () => {
        state.job?.abort(cancelled());
        windows.delete(sender.id);
      });
    }
    return state;
  }

  function handle(channel, action) {
    ipcMain.handle('uvr:' + channel, (event) => {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame || frame.url !== entryUrl) {
        throw new Error('Acceso a VocalRemover denegado.');
      }
      return action(event.sender, getState(event.sender));
    });
  }

  async function choose(sender, state, options) {
    const window = BrowserWindow.fromWebContents(sender);
    if (!window || state.job) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, options);
    return canceled || state.job ? null : filePaths[0] ?? null;
  }

  handle('status', async () => (await runtimeFor(app, findFfmpeg)) ? 'prepared' : 'unavailable');
  handle('choose-input', async (sender, state) => {
    const picked = await choose(sender, state, {
      title: 'Elegir audio o video',
      properties: ['openFile'],
      filters: [{ name: 'Audio o video', extensions: fileExtensions }],
    });
    if (!picked) return null;
    if (!fileExtensions.includes(path.extname(picked).slice(1).toLowerCase())) {
      throw new Error('Elegí un archivo local de audio o video compatible.');
    }
    if (!localPath(picked)) throw new Error('Elegí un archivo de este equipo.');
    const source = await readableFile(picked);
    const { size } = await stat(source);
    if (!size || size > 1024 ** 3) throw new Error('Elegí un archivo de hasta 1 GB que tenga audio.');
    if (state.job) return null;
    state.input = source;
    return { name: path.basename(source) };
  });
  handle('choose-output', async (sender, state) => {
    const picked = await choose(sender, state, {
      title: 'Elegir carpeta para las pistas WAV',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!picked) return null;
    if (!localPath(picked)) throw new Error('Elegí una carpeta de este equipo.');
    const output = await realpath(picked);
    if (!localPath(output) || !(await stat(output)).isDirectory()) throw new Error('Elegí una carpeta local.');
    await access(output, constants.W_OK);
    if (state.job) return null;
    state.output = output;
    return { name: path.basename(output) || output };
  });
  handle('separate', async (sender, state) => {
    if (state.job) throw new Error('Ya hay una separación en curso.');
    if (!state.input || !state.output) throw new Error('Elegí un archivo y una carpeta de salida.');

    const controller = new AbortController();
    state.job = controller;
    const { input, output } = state;
    const sendProgress = (update) => {
      if (!sender.isDestroyed() && !controller.signal.aborted) sender.send('uvr:progress', update);
    };

    try {
      const runtime = await runtimeFor(app, findFfmpeg);
      if (!runtime) throw new Error('Falta preparar el motor local UVR 5.6 y FFmpeg.');
      const result = await separateFile(runtime, input, output, controller.signal, sendProgress);
      const token = randomUUID();
      state.result = { ...result, token, output };
      sendProgress({ percent: 100, message: 'Pistas guardadas.' });
      return { token, vocalsName: path.basename(result.vocals), instrumentalName: path.basename(result.instrumental) };
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      state.job = null;
    }
  });
  handle('cancel', (_sender, state) => state.job?.abort(cancelled()));
  handle('open-output', (_sender, state) => state.result
    ? shell.openPath(state.result.output)
    : 'No hay pistas guardadas.');
}

module.exports = { registerVocalRemover, resolveVocalReference };
