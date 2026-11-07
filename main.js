'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification, Menu, nativeImage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox'); // necesario dentro de un AppImage (sin SUID)
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
if (process.platform === 'win32') app.setAppUserModelId('com.rike.priorityhub');

const { Store, DEFAULT_DEST } = require('./lib/store');
const { detect, pickForItem } = require('./lib/detect');
const { TYPES, typesFor } = require('./lib/classify');
const { PLATFORM, isWin } = require('./lib/platform');
const installer = require('./lib/installer');
const sys = require('./lib/system');
const { signature, watchId } = require('./lib/watch');

let win = null;
let store = null;
let timer = null;
let watchTimer = null;
let watching = false;
let checking = false;
const jobs = new Map();

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const ctx = (extra = {}) => ({ githubToken: store.settings.githubToken, ...extra });

/* ---------- biblioteca ---------- */
function publicItem(i) {
  const t = TYPES[i.type] || {};
  return { ...i, exists: fs.existsSync(i.path), typeLabel: t.label || i.type, typeIcon: t.icon || 'ph-package' };
}
const sendLibrary = () => send('hub:library', store.library.map(publicItem));

const stripExt = (n) => n.replace(/\.(appimage|exe|msi|ps1|bat|cmd|sh|bash|py|run|bin|jar|flatpak|deb|rpm|snap|zip|tgz|txz|tbz2|tar(\.(gz|xz|bz2|zst))?|pkg\.tar\.(zst|xz|gz))$/i, '');
const insideDir = (p, dir) => { const r = path.relative(dir, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };

async function installAsset(p, jobId, existing) {
  const ac = new AbortController();
  jobs.set(jobId, ac);
  const itemId = existing ? existing.id : crypto.randomUUID();
  const displayName = p.displayName || stripExt(p.asset.name);
  let fallbackIconPng = null;
  if (p.iconData && !/^data:image\/svg/.test(p.iconData)) {
    try { const img = nativeImage.createFromDataURL(p.iconData); if (!img.isEmpty()) fallbackIconPng = img.toPNG(); } catch { /* sin icono */ }
  }
  try {
    const r = await installer.install({
      asset: p.asset, destDir: p.destDir, fileName: p.fileName, addDesktop: p.addDesktop, itemId, displayName,
      signal: ac.signal, fallbackIconPng, onProgress: (pr) => send('hub:progress', { jobId, ...pr }),
    });
    if (existing && existing.path !== r.path && insideDir(existing.path, existing.destDir)) {
      await fsp.rm(existing.path, { recursive: true, force: true }).catch(() => {});
    }
    const item = {
      id: itemId, name: displayName, type: p.asset.type, path: r.path, launchPath: r.launchPath, destDir: r.destDir, fileName: r.fileName,
      fixedName: !!p.fixedName, size: r.size, sha256: r.sha256, verified: r.verified,
      version: p.version || p.asset.version || '', rev: p.asset.rev || '', publishedAt: p.asset.date || '',
      origin: p.asset.origin || p.origin || '', pattern: p.asset.pattern, via: p.asset.via || '',
      iconData: p.iconData || (existing && existing.iconData) || '', track: p.track !== false, autoUpdate: !!p.autoUpdate, desktopFile: r.desktopFile || '', icon: r.icon || '',
      installedAt: existing ? existing.installedAt : Date.now(), updatedAt: Date.now(), lastChecked: Date.now(), latest: null, error: '',
    };
    store.upsert(item);
    sendLibrary();
    return item;
  } finally { jobs.delete(jobId); }
}

async function updateItem(item) {
  if (!item.latest) return item;
  const asset = item.latest.asset;
  return installAsset({
    asset, destDir: item.destDir, fileName: item.fixedName ? item.fileName : asset.name, fixedName: item.fixedName,
    addDesktop: !!item.desktopFile, displayName: item.name, version: item.latest.version, track: item.track, autoUpdate: item.autoUpdate,
  }, 'upd:' + item.id, item);
}

async function checkItem(item) {
  if (!item.track) return item;
  const next = { ...item, lastChecked: Date.now() };
  try {
    const res = await detect(item.origin, ctx({ light: true }));
    const asset = pickForItem(res.assets, item);
    if (!asset) { next.error = 'Ya no encuentro este archivo en su origen.'; next.latest = null; }
    else if (!item.rev && asset.rev) { next.rev = asset.rev; next.latest = null; next.error = ''; }
    else if (asset.rev && asset.rev !== item.rev) { next.latest = { version: res.version || asset.version, rev: asset.rev, asset }; next.error = ''; }
    else { next.latest = null; next.error = ''; }
  } catch (e) { next.error = e.message; }
  store.upsert(next);
  return next;
}

async function checkAll(auto) {
  if (checking) return;
  checking = true;
  send('hub:checking', true);
  const updated = [];
  try {
    for (const it of [...store.library]) {
      let cur = await checkItem(it);
      sendLibrary();
      if (auto && cur.latest && cur.autoUpdate) {
        try { cur = await updateItem(cur); updated.push(cur.name); } catch (e) { store.upsert({ ...cur, error: e.message }); }
        sendLibrary();
      }
    }
  } finally { checking = false; send('hub:checking', false); }
  if (updated.length && store.settings.notify && Notification.isSupported()) {
    new Notification({ title: 'Priority Hub', body: `Actualizado: ${updated.join(', ')}` }).show();
  }
  if (updated.length) send('hub:toast', { kind: 'ok', text: `Actualizado: ${updated.join(', ')}` });
}

/* ---------- vigilancia de páginas ---------- */
const sendWatches = () => send('hub:watches', store.watches);

function notifyChange(w, version) {
  const text = `${w.title}: hay cambios${version ? ' · ' + version : ''}`;
  if (store.settings.notify && Notification.isSupported()) new Notification({ title: 'Priority Hub', body: text }).show();
  send('hub:toast', { kind: 'ok', text });
}

async function checkWatch(w) {
  const next = { ...w, lastChecked: Date.now() };
  try {
    const res = await detect(w.input, ctx({ light: true }));
    const sig = signature(res);
    if (!w.baselined) { next.sig = sig; next.baselined = true; next.version = res.version || w.version; next.assetCount = res.assets.length; }
    else if (sig !== w.sig) {
      next.changed = true; next.prevVersion = w.version; next.version = res.version || w.version;
      next.sig = sig; next.assetCount = res.assets.length; next.changedAt = Date.now();
      notifyChange(w, res.version);
    }
    next.error = '';
  } catch (e) { next.error = e.message; }
  store.upsertWatch(next);
  return next;
}

async function checkWatches() {
  if (watching) return;
  watching = true;
  send('hub:watching', true);
  try { for (const w of [...store.watches]) { await checkWatch(w); sendWatches(); } } finally { watching = false; send('hub:watching', false); }
}

function armTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => checkAll(true), store.settings.checkEveryHours * 3600 * 1000);
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = setInterval(checkWatches, store.settings.watchEveryMinutes * 60 * 1000);
}

/* ---------- IPC ---------- */
function registerIpc() {
  const h = (name, fn) => ipcMain.handle(name, async (_e, ...a) => {
    try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  const need = (id) => { const i = store.get(id); if (!i) throw new Error('Esa entrada ya no existe.'); return i; };

  h('settings:get', () => ({ ...store.settings, defaults: DEFAULT_DEST, types: typesFor(PLATFORM).map((key) => ({ key, label: TYPES[key].label, icon: TYPES[key].icon })), platform: PLATFORM, terminal: (sys.findTerminal() || {}).name || null, version: app.getVersion() }));
  h('settings:set', (patch) => { const s = store.patchSettings(patch || {}); armTimer(); return s; });
  h('clipboard:read', () => clipboard.readText());
  h('open:url', (url) => { if (/^https?:\/\//i.test(url)) return shell.openExternal(url); throw new Error('URL no válida'); });

  h('detect', (input) => detect(input, ctx()));

  h('watch:list', () => store.watches);
  h('watch:add', (d) => {
    const id = watchId(d.input);
    const w = store.getWatch(id) || { id, input: d.input, title: d.title, kind: d.kind, icon: d.icon || '', version: d.version || '', assetCount: d.assetCount || 0, addedAt: Date.now(), baselined: false, changed: false };
    store.upsertWatch(w);
    sendWatches();
    checkWatch(w).then(sendWatches);
    return w;
  });
  h('watch:remove', (id) => { store.removeWatch(id); sendWatches(); });
  h('watch:check', async (id) => { if (id) { const w = store.getWatch(id); if (w) await checkWatch(w); sendWatches(); } else await checkWatches(); });
  h('watch:ack', (id) => { const w = store.getWatch(id); if (w) { store.upsertWatch({ ...w, changed: false }); sendWatches(); } });

  h('dest:presets', (type) => {
    const s = store.settings;
    const home = os.homedir();
    const desk = fs.existsSync(path.join(home, 'Escritorio')) ? '~/Escritorio' : '~/Desktop';
    const base = isWin ? [
      { label: 'Programas del usuario', path: '~/AppData/Local/Programs' },
      { label: 'Descargas', path: '~/Downloads' },
      { label: 'Escritorio', path: '~/Desktop' },
      { label: 'Documentos', path: '~/Documents' },
    ] : [
      { label: 'AppImages', path: '~/Descargas/appimages' },
      { label: 'Applications', path: '~/Applications' },
      { label: 'Binarios del usuario (PATH)', path: '~/.local/bin' },
      { label: 'Descargas', path: '~/Descargas' },
      { label: 'Escritorio', path: desk },
      { label: 'Documentos', path: '~/Documentos' },
    ];
    const list = [
      { label: 'Predeterminada para este tipo', path: s.destByType[type] || (isWin ? '~/Downloads' : '~/Descargas'), def: true },
      ...base,
      ...(s.recentDirs || []).map((p) => ({ label: 'Reciente', path: p })),
    ];
    const seen = new Set();
    return list.filter((x) => { const k = sys.expand(x.path); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((x) => ({ ...x, abs: sys.expand(x.path), exists: fs.existsSync(sys.expand(x.path)) }));
  });
  h('dest:pick', async (def) => {
    const r = await dialog.showOpenDialog(win, { title: 'Elige la carpeta de destino', defaultPath: sys.expand(def || '~'), properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('path:exists', (dir, name) => fs.existsSync(path.join(sys.expand(dir), installer.safeName(name))));

  h('install', async (p) => {
    const dest = path.resolve(sys.expand(p.destDir));
    const predicted = path.join(dest, installer.safeName(p.fileName || p.asset.name));
    const existing = store.library.find((i) => i.path === predicted || (i.origin === p.asset.origin && i.pattern === p.asset.pattern && i.destDir === dest)) || null;
    const item = await installAsset({ ...p, destDir: dest }, p.jobId, existing);
    if (p.remember) store.patchSettings({ destByType: { [p.asset.type]: dest } });
    store.rememberDir(dest);
    return publicItem(item);
  });
  h('install:cancel', (jobId) => { const ac = jobs.get(jobId); if (ac) ac.abort(); });

  h('library:list', () => store.library.map(publicItem));
  h('library:set', (id, patch) => {
    const it = need(id);
    const allowed = {};
    for (const k of ['autoUpdate', 'track', 'name']) if (k in patch) allowed[k] = patch[k];
    return publicItem(store.upsert({ ...it, ...allowed }));
  });
  h('library:remove', async (id, deleteFile) => {
    const it = need(id);
    if (deleteFile && insideDir(it.path, it.destDir)) await fsp.rm(it.path, { recursive: true, force: true });
    await sys.removeDesktopEntry(it.desktopFile, String(it.id).slice(0, 8)).catch(() => {});
    store.remove(id);
    sendLibrary();
  });
  h('library:check', async (id) => {
    if (id) { await checkItem(need(id)); sendLibrary(); } else await checkAll(false);
  });
  h('library:update', async (id) => publicItem(await updateItem(need(id))));
  h('library:reveal', (id) => { const it = need(id); shell.showItemInFolder(it.path); });

  h('library:run', async (id) => {
    const it = need(id);
    if (!fs.existsSync(it.path)) throw new Error('El archivo ya no está en esa ruta.');
    if (it.type === 'exe' || it.type === 'msi') {
      const err = await shell.openPath(it.launchPath || it.path);
      if (err) throw new Error(err);
      return { launched: true };
    }
    if (['appimage', 'binary', 'archive'].includes(it.type)) {
      if (!it.launchPath) throw new Error('No encontré qué ejecutar dentro de la carpeta. Ábrela y lánzalo a mano.');
      sys.launchDetached(it.launchPath);
      return { launched: true };
    }
    if (it.type === 'jar') { sys.launchDetached('java', ['-jar', it.path], path.dirname(it.path)); return { launched: true }; }
    const command = sys.terminalCommandFor(it.type, it.path);
    if (!command) { shell.showItemInFolder(it.path); return { revealed: true }; }
    return { needsConfirm: true, command, type: it.type, name: it.name, terminal: (sys.findTerminal() || {}).name || null };
  });
  h('library:preview', (id) => sys.scriptPreview(need(id).path));
  h('library:terminal', (id) => {
    const it = need(id);
    const command = sys.terminalCommandFor(it.type, it.path);
    if (!command) throw new Error('Este tipo de archivo no se ejecuta en terminal.');
    if (!isWin && ['script', 'installer'].includes(it.type)) fs.chmodSync(it.path, 0o755);
    return sys.openInTerminal(command, path.dirname(it.path));
  });
}

/* ---------- ventana ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 920, minHeight: 620, show: false, backgroundColor: '#0b0c0d', title: 'Priority Hub',
    icon: path.join(__dirname, 'assets/icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.PH_DEBUG) win.webContents.on('console-message', (_e, lvl, msg, line, src) => console.log(`[renderer ${lvl}] ${msg} (${path.basename(src || '')}:${line})`));
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store = new Store(app.getPath('userData'));
  registerIpc();
  createWindow();
  armTimer();
  setTimeout(() => checkAll(true), 6000);
  setTimeout(checkWatches, 10000);
  if (process.env.PH_TEST) require(process.env.PH_TEST)({ win, app, store });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
