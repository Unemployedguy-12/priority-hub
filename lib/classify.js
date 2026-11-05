'use strict';
// Clasifica nombres de archivo en tipos instalables (Linux y Windows) y puntúa compatibilidad con el sistema actual.
const { PLATFORM } = require('./platform');

const TYPES = {
  exe:       { label: 'Programa .exe',     rank: 50, icon: 'ph-app-window', os: 'win' },
  msi:       { label: 'Instalador .msi',   rank: 46, icon: 'ph-wrench', os: 'win' },
  appimage:  { label: 'AppImage',          rank: 50, icon: 'ph-package', os: 'linux' },
  pacman:    { label: 'Paquete Arch',      rank: 46, icon: 'ph-archive-box', os: 'linux' },
  flatpak:   { label: 'Flatpak',           rank: 38, icon: 'ph-cube', os: 'linux' },
  binary:    { label: 'Binario',           rank: 34, icon: 'ph-cpu', os: 'linux' },
  script:    { label: 'Script',            rank: 30, icon: 'ph-terminal-window', os: 'any' },
  installer: { label: 'Instalador .run',   rank: 28, icon: 'ph-wrench', os: 'linux' },
  archive:   { label: 'Comprimido',        rank: 22, icon: 'ph-file-zip', os: 'any' },
  jar:       { label: 'Java .jar',         rank: 18, icon: 'ph-coffee', os: 'any' },
  deb:       { label: 'Paquete .deb',      rank: 12, icon: 'ph-file-arrow-down', os: 'linux' },
  rpm:       { label: 'Paquete .rpm',      rank: 8,  icon: 'ph-file-arrow-down', os: 'linux' },
  snap:      { label: 'Snap',              rank: 6,  icon: 'ph-package', os: 'linux' },
};

const hostOs = (platform) => (platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux');
/** Tipos que tienen sentido en una plataforma (para mostrar en Ajustes). */
const typesFor = (platform = PLATFORM) => Object.keys(TYPES).filter((k) => TYPES[k].os === 'any' || TYPES[k].os === hostOs(platform));

const BAD_EXT = /\.(sha\d*|sha256sum|sha512sum|md5|sig|asc|pem|sbom|json|ya?ml|txt|md|blockmap|zsync|dmg|pkg|apk|ipa|nupkg|7z|rar|whl|gem|sum|minisig|spdx|cdx|html?|css|js|png|jpe?g|gif|svg|webp|ico|pdf)$/i;

const B = '(^|[^a-z0-9])';
const E = '([^a-z0-9]|$)';
const tok = (alts) => new RegExp(`${B}(${alts})${E}`);
const RE_X64 = tok('x86[_-]?64|amd64|x64|linux64|64[-_]?bit');
const RE_ARM = tok('aarch64|arm64|armv[5-8]\\w*|armhf|armel|arm');
const RE_X86 = tok('i[3-6]86|x86|386|ia32');
const RE_ODD = tok('ppc64(le)?|riscv64|s390x|mips\\w*|loong\\w*');
const RE_WIN = tok('windows|win|win32|win64');
const RE_MAC = tok('darwin|macos|osx|apple|mac');
const RE_LINUX = tok('linux');
const RE_OTHER_OS = tok('freebsd|openbsd|netbsd|android|ios|wasm');

/** @returns {{os:string,type:string}|null} */
function typeOf(n) {
  if (/\.appimage$/.test(n)) return { type: 'appimage', os: 'linux' };
  if (/\.pkg\.tar\.(zst|xz|gz)$/.test(n)) return { type: 'pacman', os: 'linux' };
  if (/\.(flatpak|flatpakref)$/.test(n)) return { type: 'flatpak', os: 'linux' };
  if (/\.(ps1|bat|cmd)$/.test(n)) return { type: 'script', os: 'win' };
  if (/\.(sh|bash)$/.test(n)) return { type: 'script', os: 'linux' };
  if (/\.py$/.test(n)) return { type: 'script', os: 'any' };
  if (/\.exe$/.test(n)) return { type: 'exe', os: 'win' };
  if (/\.msi$/.test(n)) return { type: 'msi', os: 'win' };
  if (/\.(run|bin)$/.test(n)) return { type: 'installer', os: 'linux' };
  if (/\.deb$/.test(n)) return { type: 'deb', os: 'linux' };
  if (/\.rpm$/.test(n)) return { type: 'rpm', os: 'linux' };
  if (/\.snap$/.test(n)) return { type: 'snap', os: 'linux' };
  if (/\.jar$/.test(n)) return { type: 'jar', os: 'any' };
  if (/\.(tar\.(gz|xz|bz2|zst)|tgz|txz|tbz2|tar|zip)$/.test(n)) return { type: 'archive', os: 'any' };
  if (/linux/.test(n) && !/\.[a-z][a-z0-9]{1,5}$/.test(n.replace(/\d+(\.\d+)+/g, ''))) return { type: 'binary', os: 'linux' };
  return null;
}

/** Crea un clasificador para una plataforma/arquitectura concreta (por defecto, la actual). */
function createClassifier(platform = PLATFORM, arch = process.arch) {
  const HOST = hostOs(platform);
  const HOST_ARCH = arch === 'arm64' ? 'arm64' : 'x64';

  function compat(n, typeOs) {
    const x64 = RE_X64.test(n), arm = RE_ARM.test(n), odd = RE_ODD.test(n);
    const x86 = !x64 && RE_X86.test(n);
    const hasWin = RE_WIN.test(n), hasMac = RE_MAC.test(n), hasLinux = RE_LINUX.test(n);
    let nameOsBad;
    if (HOST === 'win') nameOsBad = (hasLinux || hasMac) && !hasWin;
    else if (HOST === 'mac') nameOsBad = (hasLinux || hasWin) && !hasMac;
    else nameOsBad = (hasWin || hasMac) && !hasLinux;
    const osBad = nameOsBad || RE_OTHER_OS.test(n) || (typeOs !== 'any' && typeOs !== HOST);
    let archOk = false, archBad = false;
    if (HOST_ARCH === 'x64') { archOk = x64; archBad = (arm || x86 || odd) && !x64; }
    else { archOk = arm; archBad = (x64 || x86 || odd) && !arm; }
    return { archOk, ok: !osBad && !archBad };
  }

  function classifyAsset(name) {
    const n = String(name || '').toLowerCase().trim();
    if (!n || BAD_EXT.test(n)) return null;
    const t = typeOf(n);
    if (!t) return null;
    const c = compat(n, t.os);
    let score = TYPES[t.type].rank + (c.archOk ? 15 : 0) - (c.ok ? 0 : 100);
    if (/(debug|symbols|dbgsym|source|[-_.]src[-_.]|docs?[-_.])/.test(n)) score -= 20;
    if (t.type === 'exe' && /(uninstall|unins\d|crashpad|updater)/.test(n)) score -= 30;
    return { type: t.type, label: TYPES[t.type].label, icon: TYPES[t.type].icon, ok: c.ok, score };
  }
  return { classifyAsset, host: HOST };
}

const current = createClassifier();
const classifyAsset = current.classifyAsset;

/** Patrón regex (string) que sobrevive a cambios de versión en el nombre. */
function assetPattern(name) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(name).split(/(v?\d+(?:\.\d+)+)/g);
  if (parts.length === 1) return '^' + esc(name) + '$';
  return '^' + parts.map((p, i) => (i % 2 ? '[vV]?\\d+(?:\\.\\d+)+' : esc(p))).join('') + '$';
}

function fileNameFromUrl(href) {
  try {
    const u = new URL(href);
    const segs = u.pathname.split('/').filter(Boolean);
    let last = segs[segs.length - 1] || '';
    if (last === 'download' && /sourceforge\.net$/.test(u.hostname)) last = segs[segs.length - 2] || '';
    return decodeURIComponent(last);
  } catch { return ''; }
}

function humanSize(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}

module.exports = { TYPES, typesFor, createClassifier, classifyAsset, assetPattern, fileNameFromUrl, humanSize };
