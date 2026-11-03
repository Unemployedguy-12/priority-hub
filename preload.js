'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const EVENTS = new Set(['hub:progress', 'hub:library', 'hub:toast', 'hub:checking', 'hub:watches', 'hub:watching']);

contextBridge.exposeInMainWorld('hub', {
  settingsGet: call('settings:get'),
  settingsSet: call('settings:set'),
  clipboard: call('clipboard:read'),
  openUrl: call('open:url'),
  detect: call('detect'),
  presets: call('dest:presets'),
  pickDir: call('dest:pick'),
  exists: call('path:exists'),
  install: call('install'),
  cancel: call('install:cancel'),
  libList: call('library:list'),
  libSet: call('library:set'),
  libRemove: call('library:remove'),
  libCheck: call('library:check'),
  libUpdate: call('library:update'),
  libReveal: call('library:reveal'),
  libRun: call('library:run'),
  libPreview: call('library:preview'),
  libTerminal: call('library:terminal'),
  watchList: call('watch:list'),
  watchAdd: call('watch:add'),
  watchRemove: call('watch:remove'),
  watchCheck: call('watch:check'),
  watchAck: call('watch:ack'),
  on(channel, cb) {
    if (!EVENTS.has(channel)) return () => {};
    const fn = (_e, p) => cb(p);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
