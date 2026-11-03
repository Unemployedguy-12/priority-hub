'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { once } = require('events');
const { createDesktopEntry, execP, expand } = require('./system');

const EXEC_TYPES = new Set(['appimage', 'binary', 'script', 'installer']);
const DESKTOP_TYPES = new Set(['appimage', 'binary', 'archive']);

function uaFor(url) {
  try { if (/sourceforge\.net$/.test(new URL(url).hostname)) return 'Wget/1.21.4'; } catch { /* nada */ }
  return 'PriorityHub/1.0 (Linux; Electron)';
}

async function downloadTo(url, file, { onProgress, signal, expectBinary }) {
  const res = await fetch(url, { headers: { 'User-Agent': uaFor(url) }, redirect: 'follow', signal });
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (expectBinary && type.includes('text/html')) throw new Error('El enlace devolvió una página web, no un archivo.');
  const total = +res.headers.get('content-length') || 0;
  const ws = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  let got = 0, last = 0;
  const t0 = Date.now();
  try {
    for await (const chunk of Readable.fromWeb(res.body)) {
      hash.update(chunk);
      if (!ws.write(chunk)) await once(ws, 'drain');
      got += chunk.length;
      const now = Date.now();
      if (now - last > 90) { last = now; onProgress && onProgress({ received: got, total, speed: got / Math.max(0.001, (now - t0) / 1000) }); }
    }
    ws.end();
    await once(ws, 'finish');
  } catch (e) {
    ws.destroy();
    await fsp.rm(file, { force: true });
    throw signal && signal.aborted ? new Error('Cancelado') : e;
  }
  onProgress && onProgress({ received: got, total: total || got, speed: 0 });
  return { sha256: hash.digest('hex'), size: got };
}

/** true = coincide, null = no hay checksum utilizable. Lanza si no coincide. */
async function verifyChecksum(asset, sha256) {
  if (!asset.sha256Url) return null;
  try {
    const res = await fetch(asset.sha256Url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const text = await res.text();
    const line = text.split('\n').find((l) => l.includes(asset.name)) || text;
    const m = /\b[a-f0-9]{64}\b/i.exec(line);
    if (!m) return null;
    if (m[0].toLowerCase() !== sha256) throw new Error('El checksum SHA-256 no coincide. Descarga descartada.');
    return true;
  } catch (e) {
    if (/checksum/.test(e.message)) throw e;
    return null;
  }
}

async function rmrf(p) { await fsp.rm(p, { recursive: true, force: true }); }

async function extractArchive(file, destDir, baseName) {
  const tmp = await fsp.mkdtemp(path.join(destDir, '.ph-x-'));
  try {
    if (/\.zip$/i.test(file)) await execP('unzip', ['-q', '-o', file, '-d', tmp]);
    else await execP('tar', ['-xf', file, '-C', tmp]);
    const entries = await fsp.readdir(tmp);
    let finalDir;
    if (entries.length === 1 && (await fsp.stat(path.join(tmp, entries[0]))).isDirectory()) {
      finalDir = path.join(destDir, entries[0]);
      await rmrf(finalDir);
      await fsp.rename(path.join(tmp, entries[0]), finalDir);
      await rmrf(tmp);
    } else {
      finalDir = path.join(destDir, baseName);
      await rmrf(finalDir);
      await fsp.rename(tmp, finalDir);
    }
    return finalDir;
  } catch (e) {
    await rmrf(tmp);
    if (/ENOENT/.test(e.message) || /not found/i.test(e.message)) throw new Error('Falta la herramienta de extracción (tar / unzip / zstd).');
    throw e;
  }
}

async function isExecutableFile(p) {
  try {
    const st = await fsp.stat(p);
    if (!st.isFile() || !(st.mode & 0o111)) return false;
    if (/\.(so(\.\d+)*|dll|a|o|py[co]?|txt|md|json|png|svg)$/i.test(p)) return false;
    const fh = await fsp.open(p, 'r');
    const b = Buffer.alloc(4);
    await fh.read(b, 0, 4, 0);
    await fh.close();
    return (b[0] === 0x7f && b[1] === 0x45) || (b[0] === 0x23 && b[1] === 0x21);
  } catch { return false; }
}

async function findLaunchable(dir, hint) {
  const found = [];
  async function scan(d, depth) {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth > 0) await scan(p, depth - 1);
      else if (e.isFile() && (await isExecutableFile(p))) found.push(p);
    }
  }
  await scan(dir, 2);
  const h = String(hint || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const score = (p) => {
    const n = path.basename(p).toLowerCase().replace(/[^a-z0-9]/g, '');
    return (h && n.includes(h) ? 10 : 0) + (/chrome-sandbox|crashpad|helper|updater|uninstall/.test(n) ? -20 : 0) - p.split('/').length * 0.1;
  };
  return found.sort((a, b) => score(b) - score(a))[0] || null;
}

const safeName = (n) => path.basename(String(n || '').replace(/[\0\/\\]/g, '_')).replace(/^\.+$/, '') || 'descarga';

/**
 * Descarga y coloca un asset. Devuelve los datos para guardar en la biblioteca.
 * opts: { asset, destDir, fileName, addDesktop, itemId, displayName, signal, onProgress }
 */
async function install(opts) {
  const { asset, signal, onProgress } = opts;
  const destDir = path.resolve(expand(opts.destDir));
  const fileName = safeName(opts.fileName || asset.name);
  await fsp.mkdir(destDir, { recursive: true });
  try { await fsp.access(destDir, fs.constants.W_OK); } catch { throw new Error(`No tengo permiso para escribir en ${destDir}`); }

  const part = path.join(destDir, `.${fileName}.ph-part`);
  const { sha256, size } = await downloadTo(asset.url, part, { signal, onProgress, expectBinary: asset.type !== 'script' });
  let verified = false;
  try { verified = (await verifyChecksum(asset, sha256)) === true; } catch (e) { await fsp.rm(part, { force: true }); throw e; }

  const finalFile = path.join(destDir, fileName);
  await fsp.rm(finalFile, { force: true });
  await fsp.rename(part, finalFile);
  await fsp.chmod(finalFile, EXEC_TYPES.has(asset.type) ? 0o755 : 0o644);

  let launchPath = EXEC_TYPES.has(asset.type) ? finalFile : null;
  let folder = null;
  if (asset.type === 'archive') {
    onProgress && onProgress({ phase: 'extract' });
    const base = fileName.replace(/\.(tar\.(gz|xz|bz2|zst)|tgz|txz|tbz2|tar|zip)$/i, '');
    folder = await extractArchive(finalFile, destDir, base);
    launchPath = await findLaunchable(folder, opts.displayName || base);
    await fsp.rm(finalFile, { force: true });
  }

  let desktopFile = '', icon = '';
  if (opts.addDesktop && DESKTOP_TYPES.has(asset.type) && launchPath) {
    const d = await createDesktopEntry({ id: String(opts.itemId).slice(0, 8), name: opts.displayName || fileName, exec: launchPath, withIcon: asset.type === 'appimage', fallbackPng: opts.fallbackIconPng });
    desktopFile = d.file; icon = d.icon;
  }
  return { path: folder || finalFile, folder, launchPath, destDir, fileName, size, sha256, verified, desktopFile, icon };
}

module.exports = { install, safeName, DESKTOP_TYPES, EXEC_TYPES, downloadTo };
