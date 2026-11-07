'use strict';
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const expand = (p) => String(p || '').replace(/^~(?=$|[\\/])/, os.homedir());
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Entorno limpio: evita que variables del AppImage de Priority Hub contaminen lo que lanzamos. */
function cleanEnv() {
  const env = { ...process.env };
  const appdir = env.APPDIR;
  for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE', 'GSETTINGS_SCHEMA_DIR']) delete env[k];
  if (appdir) {
    for (const k of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'QT_PLUGIN_PATH']) {
      if (env[k]) {
        const v = env[k].split(':').filter((x) => x && !x.startsWith(appdir)).join(':');
        if (v) env[k] = v; else delete env[k];
      }
    }
  }
  return env;
}

function which(cmd) {
  const exts = IS_WIN ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((x) => x.toLowerCase())] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, cmd + e);
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* siguiente */ }
    }
  }
  return null;
}

const TERMINALS = [
  ['konsole', (c) => ['-e', 'bash', '-lc', c]],
  ['kitty', (c) => ['bash', '-lc', c]],
  ['alacritty', (c) => ['-e', 'bash', '-lc', c]],
  ['foot', (c) => ['bash', '-lc', c]],
  ['wezterm', (c) => ['start', '--', 'bash', '-lc', c]],
  ['ghostty', (c) => ['-e', 'bash', '-lc', c]],
  ['gnome-terminal', (c) => ['--', 'bash', '-lc', c]],
  ['xfce4-terminal', (c) => ['-x', 'bash', '-lc', c]],
  ['xterm', (c) => ['-e', 'bash', '-lc', c]],
];

function findTerminal() {
  if (IS_WIN) return { name: 'cmd', args: null };
  const pref = (process.env.TERMINAL || '').split('/').pop();
  const order = [...TERMINALS].sort((a, b) => (b[0] === pref) - (a[0] === pref));
  for (const [name, args] of order) if (which(name)) return { name, args };
  return null;
}

function openInTerminal(command, cwd) {
  if (IS_WIN) {
    // Un .cmd temporal evita el infierno de comillas anidadas de cmd /k.
    const file = path.join(os.tmpdir(), `priority-hub-run-${Date.now()}.cmd`);
    fs.writeFileSync(file, ['@echo off', `cd /d "${cwd}"`, command, 'echo.', 'pause', ''].join('\r\n'));
    const child = spawn('cmd.exe', ['/d', '/c', 'start', '""', `"${file}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    child.on('error', () => { /* nada */ });
    child.unref();
    return 'cmd';
  }
  const t = findTerminal();
  if (!t) throw new Error('No encontré ninguna terminal (konsole, kitty, alacritty, gnome-terminal...).');
  const full = `cd ${sq(cwd)}; ${command}; echo; read -n1 -s -r -p "Listo. Pulsa una tecla para cerrar..."`;
  const child = spawn(t.name, t.args(full), { detached: true, stdio: 'ignore', env: cleanEnv() });
  child.on('error', () => { /* se informa arriba si no existe */ });
  child.unref();
  return t.name;
}

function launchDetached(file, args = [], cwd) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', cwd: cwd || path.dirname(file), env: cleanEnv() });
  child.on('error', () => { /* nada */ });
  child.unref();
}

/** Comando de terminal para cada tipo que no se lanza directo. */
function terminalCommandFor(type, file) {
  if (IS_WIN) {
    const w = `"${file}"`;
    if (type !== 'script') return null;
    if (/\.ps1$/i.test(file)) return `powershell -NoProfile -ExecutionPolicy Bypass -File ${w}`;
    if (/\.py$/i.test(file)) return `py ${w}`;
    return `call ${w}`;
  }
  const q = sq(file);
  switch (type) {
    case 'script': return /\.py$/i.test(file) ? `python3 ${q}` : `bash ${q}`;
    case 'installer': return q;
    case 'pacman': return `sudo pacman -U ${q}`;
    case 'flatpak': return `flatpak install --user ${q}`;
    case 'deb': return which('debtap') ? `debtap ${q}` : null;
    case 'snap': return `sudo snap install --dangerous ${q}`;
    default: return null;
  }
}

async function scriptPreview(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.slice(0, bytesRead).toString('utf8');
    const stat = await fh.stat();
    const flags = [];
    const checks = [
      [/\bsudo\b|\bpkexec\b|\brunas\b|Start-Process[^\n]*-Verb\s+RunAs/i, 'pide permisos de administrador'],
      [/Invoke-Expression|\biex\b|DownloadString|\s-enc(odedcommand)?\b/i, 'ejecuta código descargado u ofuscado'],
      [/Set-ExecutionPolicy|\breg\s+(add|delete)\b|HKLM|HKEY_/i, 'cambia el registro o la política de ejecución'],
      [/\bdel\s+\/[sq]|Remove-Item[^\n]*-Recurse|\bformat\s+[a-z]:/i, 'borra archivos de forma masiva'],
      [/rm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)/i, 'borra carpetas con rm -rf'],
      [/(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba)?sh/, 'descarga y ejecuta otro script'],
      [/\beval\b/, 'usa eval'],
      [/base64\s+(-d|--decode)/, 'decodifica base64'],
      [/\/etc\/|systemctl|chmod\s+[0-7]*7[0-7]*\s+\//, 'toca archivos del sistema'],
    ];
    for (const [re, label] of checks) if (re.test(text)) flags.push(label);
    return { text, truncated: stat.size > bytesRead, size: stat.size, flags };
  } finally { await fh.close(); }
}

/* ---------- menú de aplicaciones ---------- */
const execQuote = (p) => '"' + String(p).replace(/(["`$])/g, '\\$1').replace(/%/g, '%%') + '"';
const APPS_DIR = () => path.join(os.homedir(), '.local/share/applications');
const ICONS_DIR = () => path.join(os.homedir(), '.local/share/icons/priority-hub');

function execP(cmd, args, opts) {
  return new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 1 << 24, ...opts }, (e, so, se) => (e ? rej(new Error((se || e.message).toString().trim())) : res(so))));
}

async function walk(dir, depth, out = []) {
  if (depth < 0 || out.length > 400) return out;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, depth - 1, out); else out.push(p);
  }
  return out;
}

/** Extrae un icono de un AppImage SIN ejecutarlo (usa 7z si está instalado). */
async function iconFromAppImage(file, id) {
  if (!which('7z')) return null;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ph-icon-'));
  try {
    await execP('7z', ['x', '-y', `-o${tmp}`, file, '-r', '*.png', '*.svg'], { timeout: 25000 });
    const files = (await walk(tmp, 8)).filter((f) => /\.(png|svg)$/i.test(f));
    const scored = files.map((f) => {
      const rel = f.slice(tmp.length).toLowerCase();
      let s = 0;
      if (/icons?\//.test(rel)) s += 5;
      if (/apps\//.test(rel)) s += 5;
      if (/(512|256)/.test(rel)) s += 6; else if (/(128|192|1024)/.test(rel)) s += 3;
      if (rel.split('/').length <= 3) s += 4;
      if (/\.svg$/.test(rel)) s += 2;
      if (/(symbolic|tray|spinner|sprite|cursor|badge|flag|logo-small|\b16x16\b|\b22x22\b|\b24x24\b|\b32x32\b)/.test(rel)) s -= 10;
      return { f, s };
    }).sort((a, b) => b.s - a.s);
    if (!scored.length || scored[0].s < 1) return null;
    await fsp.mkdir(ICONS_DIR(), { recursive: true });
    const ext = path.extname(scored[0].f).toLowerCase();
    const dest = path.join(ICONS_DIR(), `${id}${ext}`);
    await fsp.copyFile(scored[0].f, dest);
    return dest;
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
}

/** Windows: acceso directo en el menú Inicio. */
async function createStartShortcut({ name, exec }) {
  const { shell } = require('electron');
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  await fsp.mkdir(dir, { recursive: true });
  const safe = String(name).replace(/[<>:"/\\|?*\r\n]/g, ' ').trim() || 'App';
  const file = path.join(dir, `${safe}.lnk`);
  if (!shell.writeShortcutLink(file, 'create', { target: exec, cwd: path.dirname(exec), description: 'Instalado con Priority Hub', icon: exec, iconIndex: 0 })) {
    throw new Error('No pude crear el acceso en el menú Inicio.');
  }
  return { file, icon: exec };
}

async function createDesktopEntry({ id, name, exec, withIcon, fallbackPng }) {
  if (IS_WIN) return createStartShortcut({ name, exec });
  await fsp.mkdir(APPS_DIR(), { recursive: true });
  let icon = 'application-x-executable';
  if (withIcon) { try { icon = (await iconFromAppImage(exec, id)) || icon; } catch { /* icono genérico */ } }
  if (icon === 'application-x-executable' && fallbackPng) {
    try {
      await fsp.mkdir(ICONS_DIR(), { recursive: true });
      const dest = path.join(ICONS_DIR(), `${id}.png`);
      await fsp.writeFile(dest, fallbackPng);
      icon = dest;
    } catch { /* icono genérico */ }
  }
  const file = path.join(APPS_DIR(), `priority-hub-${id}.desktop`);
  const clean = String(name).replace(/[\r\n]/g, ' ');
  const body = ['[Desktop Entry]', 'Type=Application', `Name=${clean}`, 'Comment=Instalado con Priority Hub', `Exec=${execQuote(exec)}`, `Path=${path.dirname(exec)}`, `Icon=${icon}`, 'Terminal=false', 'Categories=Utility;', 'StartupNotify=true', 'X-Priority-Hub=true', ''].join('\n');
  await fsp.writeFile(file, body, { mode: 0o644 });
  execFile('update-desktop-database', [APPS_DIR()], () => { /* opcional */ });
  return { file, icon };
}

async function removeDesktopEntry(file, id) {
  if (IS_WIN) { if (file) await fsp.rm(file, { force: true }); return; }
  if (file) await fsp.rm(file, { force: true });
  await fsp.rm(path.join(ICONS_DIR(), `${id}.png`), { force: true });
  await fsp.rm(path.join(ICONS_DIR(), `${id}.svg`), { force: true });
  execFile('update-desktop-database', [APPS_DIR()], () => { /* opcional */ });
}

module.exports = { expand, sq, cleanEnv, which, findTerminal, openInTerminal, launchDetached, terminalCommandFor, scriptPreview, createDesktopEntry, removeDesktopEntry, execP };
