'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_DEST = {
  appimage: '~/Descargas/appimages',
  script: '~/Descargas/scripts',
  installer: '~/Descargas',
  pacman: '~/Descargas/paquetes',
  flatpak: '~/Descargas/paquetes',
  binary: '~/.local/bin',
  archive: '~/Descargas/apps',
  jar: '~/Descargas/apps',
  deb: '~/Descargas/paquetes',
  rpm: '~/Descargas/paquetes',
  snap: '~/Descargas/paquetes',
};

const DEFAULTS = {
  destByType: DEFAULT_DEST,
  sounds: true,
  notify: true,
  githubToken: '',
  checkEveryHours: 6,
  watchEveryMinutes: 15,
  autoUpdateDefault: true,
  recentDirs: [],
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'priority-hub.json');
    this.data = { settings: {}, library: [], watches: [] };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { /* primera vez */ }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    const s = this.data.settings || {};
    return { ...DEFAULTS, ...s, destByType: { ...DEFAULT_DEST, ...(s.destByType || {}) } };
  }

  patchSettings(patch) {
    const cur = this.data.settings || {};
    const next = { ...cur, ...patch };
    if (patch.destByType) next.destByType = { ...(cur.destByType || {}), ...patch.destByType };
    if (typeof next.checkEveryHours !== 'number' || next.checkEveryHours < 1) next.checkEveryHours = 6;
    if (typeof next.watchEveryMinutes !== 'number' || next.watchEveryMinutes < 5) next.watchEveryMinutes = 15;
    this.data.settings = next;
    this._save();
    return this.settings;
  }

  rememberDir(dir) {
    const rec = [dir, ...(this.settings.recentDirs || []).filter((d) => d !== dir)].slice(0, 5);
    this.patchSettings({ recentDirs: rec });
  }

  get library() { return this.data.library; }
  get(id) { return this.data.library.find((i) => i.id === id) || null; }

  upsert(item) {
    const i = this.data.library.findIndex((x) => x.id === item.id);
    if (i >= 0) this.data.library[i] = item; else this.data.library.push(item);
    this._save();
    return item;
  }

  remove(id) {
    this.data.library = this.data.library.filter((i) => i.id !== id);
    this._save();
  }

  get watches() { return this.data.watches || []; }
  getWatch(id) { return this.watches.find((w) => w.id === id) || null; }

  upsertWatch(w) {
    const list = this.watches.slice();
    const i = list.findIndex((x) => x.id === w.id);
    if (i >= 0) list[i] = w; else list.push(w);
    this.data.watches = list;
    this._save();
    return w;
  }

  removeWatch(id) {
    this.data.watches = this.watches.filter((w) => w.id !== id);
    this._save();
  }
}

module.exports = { Store, DEFAULT_DEST };
