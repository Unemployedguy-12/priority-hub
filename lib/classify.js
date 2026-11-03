'use strict';
// Clasifica nombres de archivo en tipos instalables para Linux y puntúa compatibilidad.

const TYPES = {
  appimage:  { label: 'AppImage',        rank: 50, icon: 'ph-package' },
  pacman:    { label: 'Paquete Arch',    rank: 46, icon: 'ph-archive-box' },
  flatpak:   { label: 'Flatpak',         rank: 38, icon: 'ph-cube' },
  binary:    { label: 'Binario',         rank: 34, icon: 'ph-cpu' },
  script:    { label: 'Script',          rank: 30, icon: 'ph-terminal-window' },
  installer: { label: 'Instalador .run', rank: 28, icon: 'ph-wrench' },
  archive:   { label: 'Comprimido',      rank: 22, icon: 'ph-file-zip' },
  jar:       { label: 'Java .jar',       rank: 18, icon: 'ph-coffee' },
  deb:       { label: 'Paquete .deb',    rank: 12, icon: 'ph-file-arrow-down' },
  rpm:       { label: 'Paquete .rpm',    rank: 8,  icon: 'ph-file-arrow-down' },
  snap:      { label: 'Snap',            rank: 6,  icon: 'ph-package' },
};

const BAD_EXT = /\.(sha\d*|sha256sum|sha512sum|md5|sig|asc|pem|sbom|json|ya?ml|txt|md|blockmap|zsync|exe|msi|dmg|pkg|apk|ipa|nupkg|7z|rar|whl|gem|sum|minisig|spdx|cdx|html?|css|js|png|jpe?g|gif|svg|webp|ico|pdf)$/i;

const HOST_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const B = '(^|[^a-z0-9])';
const E = '([^a-z0-9]|$)';
const RE_X64 = new RegExp(`${B}(x86[_-]?64|amd64|x64|linux64|64[-_]?bit)${E}`);
const RE_ARM = new RegExp(`${B}(aarch64|arm64|armv[5-8]\\w*|armhf|armel|arm)${E}`);
const RE_X86 = new RegExp(`${B}(i[3-6]86|x86|386|ia32|win32)${E}`);
const RE_ODD = new RegExp(`${B}(ppc64(le)?|riscv64|s390x|mips\\w*|loong\\w*)${E}`);
const RE_OS = new RegExp(`${B}(windows|win|win32|win64|darwin|macos|osx|apple|mac|freebsd|openbsd|netbsd|android|ios|wasm)${E}`);

function typeOf(n) {
  if (/\.appimage$/.test(n)) return 'appimage';
  if (/\.pkg\.tar\.(zst|xz|gz)$/.test(n)) return 'pacman';
  if (/\.(flatpak|flatpakref)$/.test(n)) return 'flatpak';
  if (/\.(sh|bash|py)$/.test(n)) return 'script';
  if (/\.(run|bin)$/.test(n)) return 'installer';
  if (/\.deb$/.test(n)) return 'deb';
  if (/\.rpm$/.test(n)) return 'rpm';
  if (/\.snap$/.test(n)) return 'snap';
  if (/\.jar$/.test(n)) return 'jar';
  if (/\.(tar\.(gz|xz|bz2|zst)|tgz|txz|tbz2|tar|zip)$/.test(n)) return 'archive';
  if (/linux/.test(n) && !/\.[a-z][a-z0-9]{1,5}$/.test(n.replace(/\d+(\.\d+)+/g, ''))) return 'binary';
  return null;
}

function compat(n) {
  const x64 = RE_X64.test(n);
  const arm = RE_ARM.test(n);
  const x86 = !x64 && RE_X86.test(n);
  const odd = RE_ODD.test(n);
  const osBad = RE_OS.test(n) && !/linux/.test(n);
  let archOk = false, archBad = false;
  if (HOST_ARCH === 'x64') { archOk = x64; archBad = (arm || x86 || odd) && !x64; }
  else { archOk = arm; archBad = (x64 || x86 || odd) && !arm; }
  return { archOk, ok: !osBad && !archBad };
}

/** @returns {null | {type,label,icon,ok,score}} */
function classifyAsset(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n || BAD_EXT.test(n)) return null;
  const type = typeOf(n);
  if (!type) return null;
  const c = compat(n);
  let score = TYPES[type].rank + (c.archOk ? 15 : 0) - (c.ok ? 0 : 100);
  if (/(debug|symbols|dbgsym|source|[-_.]src[-_.]|docs?[-_.])/.test(n)) score -= 20;
  return { type, label: TYPES[type].label, icon: TYPES[type].icon, ok: c.ok, score };
}

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

module.exports = { TYPES, classifyAsset, assetPattern, fileNameFromUrl, humanSize };
