const { app, BrowserWindow, dialog, Menu, protocol, session } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const appOrigin = 'pitch://app';
const entryUrl = `${appOrigin}/index.html`;
const contentTypes = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([{
  scheme: 'pitch',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);
app.commandLine.appendSwitch('disable-background-networking');

function isAppOrigin(url) {
  return url === appOrigin || url?.startsWith(`${appOrigin}/`) === true;
}

function configureSession(appSession) {
  appSession.webRequest.onBeforeRequest(({ url }, callback) => {
    callback({ cancel: /^(https?|wss?|ftp):/i.test(url) });
  });

  appSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    permission === 'media' && details.mediaType === 'audio' && details.isMainFrame &&
    contents?.getURL() === entryUrl && isAppOrigin(details.securityOrigin ?? origin)
  );

  appSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      permission === 'media' && details.isMainFrame && details.requestingUrl === entryUrl &&
      contents.getURL() === entryUrl && details.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === 'audio'
    );
  });

  const dist = path.join(app.getAppPath(), 'dist');
  appSession.protocol.handle('pitch', async ({ url, method }) => {
    if (!isAppOrigin(url) || method !== 'GET') {
      return new Response(null, { status: 403 });
    }

    const { pathname } = new URL(url);
    const segments = pathname.slice(1).split('/');
    const contentType = contentTypes.get(path.extname(pathname));
    if (!contentType || segments.some(segment =>
      !/^[\w.,-]+$/.test(segment) || segment === '.' || segment === '..'
    )) {
      return new Response(null, { status: 404 });
    }

    try {
      const contents = await readFile(path.join(dist, ...segments));
      return new Response(contents, {
        headers: {
          'Content-Type': contentType,
          'Content-Security-Policy': contentSecurityPolicy,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        console.error(error);
      }
      return new Response(null, { status: 404 });
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'Pitch Detector',
    width: 1200,
    height: 850,
    minWidth: 750,
    minHeight: 630,
    backgroundColor: '#101419',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => window.show());
  return window.loadURL(entryUrl);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  configureSession(session.defaultSession);
  await createWindow();
}).catch((error) => {
  console.error(error);
  dialog.showErrorBox('Pitch Detector', 'No se pudo abrir la aplicación.');
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
