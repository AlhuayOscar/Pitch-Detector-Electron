const { BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { realpath, stat } = require('node:fs/promises');
const path = require('node:path');

const playbackRate = 32_000;
const analysisRate = 16_000;
const maxDurationSeconds = 10 * 60;
const maxFileBytes = 1024 ** 3;
const maxPcmBytes = playbackRate * 2 * maxDurationSeconds;
const channel = 'reference-media:';
const extensions = [
  'wav', 'mp3', 'm4a', 'mp4', 'mov', 'flac', 'ogg', 'opus', 'webm', 'mkv',
  'aac', 'aif', 'aiff', 'avi', 'wma', 'wmv', 'mpg', 'mpeg',
];
const formats = 'wav,mp3,mov,flac,ogg,matroska,webm,aac,aiff,avi,asf,mpeg';
const globalArgs = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
const cachedInput = ['-protocol_whitelist', 'pipe', '-f', 's16le', '-ar', String(playbackRate), '-ac', '1', '-i', 'pipe:0'];

function cancellation() {
  return new Error('Se canceló el procesamiento de la canción.');
}

function localAbsolute(file) {
  return typeof file === 'string' && path.isAbsolute(file) &&
    (process.platform !== 'win32' || !file.startsWith('\\\\'));
}

function runFfmpeg(executable, args, options) {
  const { signal, input, maxBytes, errorMessage, overflowMessage = errorMessage, timeout = 90_000 } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let total = 0;
    let diagnostic = '';
    let failure;

    const stop = (error) => {
      if (failure) return;
      failure = error;
      child.kill();
    };
    const abort = () => stop(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => stop(new Error('La conversión local tardó demasiado.')), timeout);

    child.once('error', (error) => {
      console.warn('No se pudo iniciar FFmpeg.', error.message);
      failure ??= new Error(errorMessage);
    });
    child.stdout.on('data', (chunk) => {
      if (failure) return;
      total += chunk.length;
      if (total > maxBytes) {
        stop(new Error(overflowMessage));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (diagnostic.length < 2048) diagnostic += chunk.toString('utf8').slice(0, 2048 - diagnostic.length);
    });
    child.once('close', (code) => {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      if (failure) {
        reject(failure);
      } else if (code !== 0) {
        if (diagnostic) console.warn('FFmpeg terminó con un error.', diagnostic.trim());
        reject(new Error(errorMessage));
      } else {
        resolve(Buffer.concat(chunks, total));
      }
    });

    if (input) {
      child.stdin.on('error', (error) => {
        if (error.code !== 'EPIPE') stop(new Error(errorMessage));
      });
      child.stdin.end(input);
    }
  });
}

async function findFfmpeg(app) {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  const roots = portable ? [portable, path.dirname(portable)] : [app.getAppPath()];
  const dirs = roots.map((root) => path.join(root, '.uvr', 'ultimatevocalremovergui'));
  const scoopRoots = [
    process.env.SCOOP,
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'scoop'),
    process.env.SCOOP_GLOBAL,
    process.env.ProgramData && path.join(process.env.ProgramData, 'scoop'),
  ].filter(localAbsolute);
  const scoopBins = scoopRoots.map((root) => path.join(root, 'apps', 'ffmpeg', 'current', 'bin'));
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).map((value) => value.trim().replace(/^"(.*)"$/, '$1'));

  for (const dir of new Set([...dirs, ...scoopBins, ...pathDirs].filter(localAbsolute))) {
    try {
      const executable = await realpath(path.join(dir, exe));
      if (!localAbsolute(executable) || !(await stat(executable)).isFile()) continue;

      const version = await runFfmpeg(executable, ['-version'], {
        maxBytes: 64 * 1024,
        timeout: 5_000,
        errorMessage: 'No se pudo comprobar FFmpeg.',
      });
      const text = version.toString('utf8');
      if (/^ffmpeg version\s/i.test(text)) {
        return { executable, rubberband: /(?:\s|^)--enable-librubberband(?=\s|$)/.test(text) };
      }
    } catch {
      // A missing or unusable candidate leaves the next local installation available.
    }
  }

  throw new Error('No se encontró FFmpeg. Prepará VocalRemover o instalá FFmpeg para importar canciones.');
}

async function localSource(file) {
  if (!localAbsolute(file) || !extensions.includes(path.extname(file).slice(1).toLowerCase())) {
    throw new Error('Elegí un archivo local de audio o video compatible.');
  }

  let source;
  let info;
  try {
    source = await realpath(file);
    info = await stat(source);
  } catch {
    throw new Error('No se pudo leer el archivo seleccionado.');
  }
  if (!localAbsolute(source) || !info.isFile() || info.size === 0) {
    throw new Error('El archivo seleccionado no es un archivo local de audio o video válido.');
  }
  if (info.size > maxFileBytes) {
    throw new Error('El archivo supera el límite de 1 GB.');
  }
  return source;
}

function bytesView(buffer) {
  const { buffer: storage, byteOffset, byteLength } = buffer;
  return byteOffset === 0 && storage.byteLength === byteLength
    ? new Uint8Array(storage)
    : Uint8Array.from(buffer);
}

function waveFromPcm(pcm) {
  const wav = Buffer.allocUnsafe(44 + pcm.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(playbackRate, 24);
  wav.writeUInt32LE(playbackRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return bytesView(wav);
}

async function decodeSong(ffmpeg, file, signal) {
  const pcm = await runFfmpeg(ffmpeg.executable, [
    ...globalArgs,
    '-protocol_whitelist', 'file', '-format_whitelist', formats,
    '-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-t', String(maxDurationSeconds + 1),
    '-ac', '1', '-ar', String(playbackRate), '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
  ], {
    signal,
    maxBytes: maxPcmBytes,
    errorMessage: 'No se pudo abrir la pista de audio del archivo.',
    overflowMessage: 'La pista de audio supera el límite de 10 minutos.',
  });

  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error('El archivo no contiene una pista de audio utilizable.');
  }

  const samples = await runFfmpeg(ffmpeg.executable, [
    ...globalArgs, ...cachedInput,
    '-ar', String(analysisRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1',
  ], {
    input: pcm,
    signal,
    maxBytes: maxPcmBytes,
    errorMessage: 'No se pudo preparar el audio para el análisis.',
  });

  if (samples.length === 0 || samples.length % 4 !== 0) {
    throw new Error('La pista es demasiado corta para analizarla.');
  }

  return { pcm, samples: bytesView(samples), durationSeconds: pcm.length / 2 / playbackRate };
}

async function transposeSong(selection, semitones, signal) {
  const { ffmpeg, pcm } = selection;
  if (semitones === 0) return pcm;
  const ratio = 2 ** (semitones / 12);
  const sampleCount = pcm.length / 2;
  const filter = ffmpeg.rubberband
    ? 'rubberband=tempo=1:pitch=' + ratio + ':formant=preserved'
    : 'asetrate=' + Math.round(playbackRate * ratio) + ',aresample=' + playbackRate + ',atempo=' + 1 / ratio;
  const durationFilter = 'apad=whole_len=' + sampleCount + ',atrim=end_sample=' + sampleCount;
  const shifted = await runFfmpeg(ffmpeg.executable, [
    ...globalArgs, ...cachedInput,
    '-af', filter + ',' + durationFilter,
    '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
  ], {
    input: pcm,
    signal,
    maxBytes: pcm.length,
    errorMessage: 'No se pudo transponer la pista de audio.',
  });
  if (shifted.length !== pcm.length) {
    throw new Error('No se pudo conservar la duración de la pista transpuesta.');
  }
  return shifted;
}

function registerReferenceMedia(app, entryUrl, resolveVocalReference) {
  const windows = new WeakMap();
  let ffmpegPromise;

  function getFfmpeg() {
    ffmpegPromise ??= findFfmpeg(app).catch((error) => {
      ffmpegPromise = undefined;
      throw error;
    });
    return ffmpegPromise;
  }

  function handle(name, action) {
    ipcMain.handle(channel + name, (event, ...args) => {
      const { sender, senderFrame } = event;
      if (!senderFrame || senderFrame !== sender.mainFrame || senderFrame.url !== entryUrl) {
        throw new Error('Acceso a la canción de referencia denegado.');
      }
      if (!windows.has(sender)) {
        const state = {};
        sender.once('destroyed', () => state.operation?.controller.abort(cancellation()));
        windows.set(sender, state);
      }
      return action(windows.get(sender), sender, ...args);
    });
  }

  async function operate(state, kind, action) {
    if (state.operation?.kind === 'select') throw new Error('Ya se está abriendo una canción.');
    state.operation?.controller.abort(cancellation());

    const operation = { kind, controller: new AbortController() };
    state.operation = operation;
    try {
      const result = await action(operation.controller.signal);
      operation.controller.signal.throwIfAborted();
      return result;
    } finally {
      if (state.operation === operation) state.operation = undefined;
    }
  }

  async function loadSong(state, file, signal) {
    signal.throwIfAborted();
    const source = await localSource(file);
    const ffmpeg = await getFfmpeg();
    const { pcm, samples, durationSeconds } = await decodeSong(ffmpeg, source, signal);
    signal.throwIfAborted();
    state.selection = { ffmpeg, pcm, durationSeconds };
    return { name: path.basename(file), samples, durationSeconds };
  }

  handle('select', (state, sender) => operate(state, 'select', async (signal) => {
    const window = BrowserWindow.fromWebContents(sender);
    if (!window) throw new Error('No se pudo abrir el selector de archivos.');
    const result = await dialog.showOpenDialog(window, {
      title: 'Elegir canción de referencia',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Archivos de audio y video', extensions }],
    });
    if (result.canceled) return null;

    return loadSong(state, result.filePaths[0], signal);
  }));

  handle('select-vocals', (state, sender, token) => operate(state, 'select', async (signal) => {
    const file = await resolveVocalReference(sender, token);
    return loadSong(state, file, signal);
  }));

  handle('render', (state, _sender, semitones) => {
    if (!Number.isInteger(semitones) || semitones < -12 || semitones > 12) {
      throw new Error('Elegí entre −12 y +12 semitonos.');
    }
    const { selection } = state;
    if (!selection) throw new Error('Elegí una canción de referencia.');
    return operate(state, 'render', async (signal) => {
      const pcm = await transposeSong(selection, semitones, signal);
      signal.throwIfAborted();
      return { wav: waveFromPcm(pcm), durationSeconds: selection.durationSeconds };
    });
  });

  handle('cancel', (state) => state.operation?.controller.abort(cancellation()));
}

module.exports = { registerReferenceMedia, findFfmpeg };
