const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vocalRemover', {
  status: () => ipcRenderer.invoke('uvr:status'),
  chooseInput: () => ipcRenderer.invoke('uvr:choose-input'),
  chooseOutput: () => ipcRenderer.invoke('uvr:choose-output'),
  separate: () => ipcRenderer.invoke('uvr:separate'),
  cancel: () => ipcRenderer.invoke('uvr:cancel'),
  openOutput: () => ipcRenderer.invoke('uvr:open-output'),
  onProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('uvr:progress', listener);
    return () => ipcRenderer.removeListener('uvr:progress', listener);
  },
});

contextBridge.exposeInMainWorld('pitchSessions', {
  begin: (mimeType) => ipcRenderer.invoke('pitch-sessions:begin', mimeType),
  appendAudio: (id, bytes) => ipcRenderer.invoke('pitch-sessions:append-audio', id, bytes),
  checkpoint: (id, data, final = false) => ipcRenderer.invoke('pitch-sessions:checkpoint', id, data, final),
  list: () => ipcRenderer.invoke('pitch-sessions:list'),
  play: (id) => ipcRenderer.invoke('pitch-sessions:play', id),
  showFolder: () => ipcRenderer.invoke('pitch-sessions:show-folder'),
  onFlush: (handler) => {
    const listener = () => {
      Promise.resolve().then(handler)
        .catch((error) => console.error('No se pudo cerrar la grabación.', error))
        .finally(() => ipcRenderer.send('pitch-sessions:flushed'));
    };
    ipcRenderer.on('pitch-sessions:flush', listener);
    return () => ipcRenderer.removeListener('pitch-sessions:flush', listener);
  },
});

contextBridge.exposeInMainWorld('referenceMedia', {
  select: () => ipcRenderer.invoke('reference-media:select'),
  selectVocals: (token) => ipcRenderer.invoke('reference-media:select-vocals', token),
  render: (semitones) => ipcRenderer.invoke('reference-media:render', semitones),
  cancel: () => ipcRenderer.invoke('reference-media:cancel'),
});
