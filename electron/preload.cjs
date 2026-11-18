const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vocalRemover', {
  status: () => ipcRenderer.invoke('uvr:status'),
  launch: () => ipcRenderer.invoke('uvr:launch'),
  locate: () => ipcRenderer.invoke('uvr:locate'),
  openRelease: () => ipcRenderer.invoke('uvr:download'),
});
