'use strict';
// Dado cualquier enlace (repo, página, archivo directo) devuelve los descargables encontrados.
const { classifyAsset, assetPattern, fileNameFromUrl } = require('./classify');

const UA = 'PriorityHub/1.0 (Linux; Electron)';
const NOT_REPO_OWNERS = new Set(['features', 'topics', 'orgs', 'settings', 'marketplace', 'sponsors', 'about', 'pricing', 'login', 'search', 'explore', 'collections', 'trending', 'apps', 'enterprise', 'security', 'notifications', 'new', 'issues', 'pulls', 'codespaces', 'events', 'solutions', 'resources', 'team', 'contact', 'site', 'partners', 'join', 'signup', 'organizations', 'users', 'readme', 'customer-stories']);

/* ---------- red ---------- */
function uaFor(url) {
  try { if (/sourceforge\.net$/.test(new URL(url).hostname)) return 'Wget/1.21.4'; } catch { /* nada */ }
  return UA;
}

async function http(url, { method = 'GET', headers = {}, timeout = 15000 } = {}) {
  return fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': uaFor(url), ...headers } });
}

async function getJson(url, { headers = {}, softCodes = [404] } = {}) {
  const res = await http(url, { headers: { Accept: 'application/json', ...headers } });
  if (softCodes.includes(res.status)) return null;
  if (res.status === 403 || res.status === 429) {
    const e = new Error('Límite de peticiones alcanzado. Para GitHub agrega un token en Ajustes.');
    e.status = res.status; throw e;
  }
  if (!res.ok) { const e = new Error(`El sitio respondió ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

const gh = (path, ctx) => getJson('https://api.github.com' + path, {
  headers: { Accept: 'application/vnd.github+json', ...(ctx.githubToken ? { Authorization: `Bearer ${ctx.githubToken}` } : {}) },
});

async function readLimited(res, limit) {
  const reader = res.body.getReader();
  const chunks = []; let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
    if (n > limit) { await reader.cancel(); break; }
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/** Descarga un icono y lo devuelve como data: URL (así la CSP de la interfaz no necesita abrirse a internet). */
async function fetchIcon(url) {
  if (!url) return '';
  try {
    const r = await http(url, { timeout: 6000, headers: { Accept: 'image/*' } });
    if (!r.ok) return '';
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 200000) return '';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

/* ---------- entrada ---------- */
function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/^git clone\s+/i, '');
  const ssh = /^git@([\w.-]+):(.+?)(?:\.git)?$/.exec(s);
  if (ssh) s = `https://${ssh[1]}/${ssh[2]}`;
  if (/\s/.test(s)) { const m = /https?:\/\/[^\s'"|;)]+/.exec(s); if (!m) return null; s = m[0]; }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = s.replace(/^github:/i, '');
    s = /^[\w-]+\/[\w.-]+$/.test(s) ? `https://github.com/${s}` : `https://${s}`;
  }
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
}

/* ---------- construcción de resultados ---------- */
function buildAssets(raws, common = {}) {
  const byName = new Map(raws.map((r) => [r.name, r.url]));
  const out = [];
  for (const r of raws) {
    const c = classifyAsset(r.name);
    if (!c) continue;
    const sha = [`${r.name}.sha256`, `${r.name}.sha256sum`, `${r.name}.sha256.txt`].map((k) => byName.get(k)).find(Boolean) || '';
    out.push({
      name: r.name, url: r.url, size: r.size || 0, rev: r.rev || '', version: r.version || '', date: r.date || '',
      via: r.via || common.via || '', origin: r.origin || common.origin || '', sha256Url: sha,
      type: c.type, typeLabel: c.label, typeIcon: c.icon, compatible: c.ok, score: c.score, pattern: assetPattern(r.name),
    });
  }
  return out;
}

function finish(res) {
  const seen = new Set();
  res.assets = res.assets.filter((a) => (seen.has(a.url) ? false : seen.add(a.url)));
  res.assets.sort((a, b) => b.score - a.score);
  const best = res.assets.find((a) => a.compatible);
  res.assets.forEach((a) => { a.recommended = a === best; });
  if (!res.assets.length) throw new Error('No encontré descargables en ese enlace. Prueba con el enlace del repo o del archivo directo.');
  return res;
}

const mk = (o) => ({ kind: 'page', title: '', description: '', homepage: '', version: '', date: '', assets: [], notes: [], icon: '', iconUrl: '', iconUrls: [], ...o });

/* ---------- GitHub ---------- */
async function githubFlow(u, ctx) {
  const segs = u.pathname.split('/').filter(Boolean);
  const o = segs[0];
  const r = (segs[1] || '').replace(/\.git$/, '');
  if (!o || !r || NOT_REPO_OWNERS.has(o.toLowerCase())) return null;
  const rest = segs.slice(2);
  if ((rest[0] === 'blob' || rest[0] === 'raw') && rest.length >= 3) {
    const file = rest.slice(2).join('/');
    if (classifyAsset(fileNameFromUrl('https://x/' + file))) return directFlow(new URL(`https://raw.githubusercontent.com/${o}/${r}/${rest[1]}/${file}`), ctx);
  }
  const base = `/repos/${o}/${r}`;
  const origin = `https://github.com/${o}/${r}`;
  const meta = ctx.light ? null : await gh(base, ctx);
  if (!ctx.light && !meta) throw new Error(`No encuentro el repo ${o}/${r} (¿es privado o está mal escrito?).`);
  let rel = null;
  if (rest[0] === 'releases' && rest[1] === 'tag' && rest[2]) rel = await gh(`${base}/releases/tags/${encodeURIComponent(decodeURIComponent(rest.slice(2).join('/')))}`, ctx);
  if (!rel) rel = await gh(`${base}/releases/latest`, ctx);
  if (!rel) { const list = await gh(`${base}/releases?per_page=5`, ctx); rel = Array.isArray(list) ? list.find((x) => !x.draft) : null; }
  const res = mk({ kind: 'github', input: origin, title: `${o}/${r}`, description: meta?.description || '', homepage: meta?.homepage || '', repoUrl: origin, iconUrl: `https://github.com/${o}.png?size=128` });
  if (rel) {
    res.version = rel.tag_name || rel.name || '';
    res.date = rel.published_at || '';
    res.assets = buildAssets((rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, rev: `${rel.tag_name}#${a.id}`, version: rel.tag_name, date: a.updated_at })), { origin });
  }
  if (!res.assets.length) {
    const files = await repoFiles(async (p) => gh(`${base}/contents${p}`, ctx));
    const raws = files.map((f) => ({ name: f.name, url: f.download_url, size: f.size, rev: f.sha, version: (f.sha || '').slice(0, 7) }));
    res.assets = buildAssets(raws, { origin });
    if (res.assets.length) { res.notes.push('Sin releases: encontré archivos sueltos dentro del repo.'); res.version = res.version || 'rama principal'; }
  }
  return res;
}

// Lista archivos instalables en la raíz y en carpetas típicas (scripts, bin...).
async function repoFiles(list) {
  const root = await list('');
  if (!Array.isArray(root)) return [];
  let files = root.filter((f) => f.type === 'file' && f.download_url);
  const dirs = root.filter((f) => f.type === 'dir' && /^(scripts?|bin|install|dist|release|releases)$/i.test(f.name)).slice(0, 2);
  for (const d of dirs) {
    const sub = await list('/' + encodeURI(d.path || d.name)).catch(() => null);
    if (Array.isArray(sub)) files = files.concat(sub.filter((f) => f.type === 'file' && f.download_url));
  }
  return files.filter((f) => !/\.py$/i.test(f.name));
}

/* ---------- GitLab ---------- */
function gitlabProject(u) {
  const i = u.pathname.indexOf('/-/');
  const p = (i >= 0 ? u.pathname.slice(0, i) : u.pathname).replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return p.includes('/') ? p : null;
}

async function gitlabFlow(u, ctx) {
  const p = gitlabProject(u);
  if (!p) return null;
  const api = `${u.origin}/api/v4/projects/${encodeURIComponent(p)}`;
  const proj = await getJson(api);
  if (!proj || !proj.id) return null;
  const origin = `${u.origin}/${p}`;
  const av = proj.avatar_url || (proj.namespace && proj.namespace.avatar_url) || '';
  const res = mk({ kind: 'gitlab', input: origin, title: p, description: proj.description || '', repoUrl: origin, iconUrl: av.startsWith('/') ? u.origin + av : av });
  const rels = (await getJson(`${api}/releases?per_page=5`, { softCodes: [404, 401, 403] })) || [];
  const rel = rels[0];
  if (rel) {
    res.version = rel.tag_name || rel.name || ''; res.date = rel.released_at || '';
    const links = (rel.assets && rel.assets.links) || [];
    res.assets = buildAssets(links.map((l) => ({ name: l.name && classifyAsset(l.name) ? l.name : fileNameFromUrl(l.direct_asset_url || l.url) || l.name, url: l.direct_asset_url || l.url, rev: `${rel.tag_name}#${l.id}`, version: rel.tag_name })), { origin });
  }
  if (!res.assets.length) {
    const tree = (await getJson(`${api}/repository/tree?per_page=100`, { softCodes: [404, 401, 403] })) || [];
    const raws = tree.filter((f) => f.type === 'blob' && !/\.py$/i.test(f.name)).map((f) => ({ name: f.name, url: `${origin}/-/raw/${proj.default_branch || 'HEAD'}/${encodeURI(f.path)}`, rev: f.id, version: (f.id || '').slice(0, 7) }));
    res.assets = buildAssets(raws, { origin });
    if (res.assets.length) { res.notes.push('Sin releases: encontré archivos sueltos dentro del repo.'); res.version = 'rama principal'; }
  }
  return res;
}

/* ---------- Gitea / Forgejo / Codeberg ---------- */
async function giteaFlow(u) {
  const segs = u.pathname.split('/').filter(Boolean);
  const o = segs[0], r = (segs[1] || '').replace(/\.git$/, '');
  if (!o || !r) return null;
  const api = `${u.origin}/api/v1/repos/${o}/${r}`;
  const meta = await getJson(api);
  if (!meta || !meta.full_name) return null;
  const origin = `${u.origin}/${o}/${r}`;
  const res = mk({ kind: 'gitea', input: origin, title: meta.full_name, description: meta.description || '', homepage: meta.website || '', repoUrl: origin, iconUrl: meta.avatar_url || (meta.owner && meta.owner.avatar_url) || '' });
  const rels = (await getJson(`${api}/releases?limit=5`, { softCodes: [404] })) || [];
  const rel = rels.find((x) => !x.draft);
  if (rel) {
    res.version = rel.tag_name || rel.name || ''; res.date = rel.published_at || rel.created_at || '';
    res.assets = buildAssets((rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, rev: `${rel.tag_name}#${a.id}`, version: rel.tag_name, date: a.created_at })), { origin });
  }
  if (!res.assets.length) {
    const files = await repoFiles((p) => getJson(`${api}/contents${p}?ref=${encodeURIComponent(meta.default_branch || 'main')}`));
    res.assets = buildAssets(files.map((f) => ({ name: f.name, url: f.download_url, size: f.size, rev: f.sha, version: (f.sha || '').slice(0, 7) })), { origin });
    if (res.assets.length) { res.notes.push('Sin releases: encontré archivos sueltos dentro del repo.'); res.version = 'rama principal'; }
  }
  return res;
}

/* ---------- Bitbucket ---------- */
async function bitbucketFlow(u) {
  const [ws, repo] = u.pathname.split('/').filter(Boolean);
  if (!ws || !repo) return null;
  const data = await getJson(`https://api.bitbucket.org/2.0/repositories/${ws}/${repo}/downloads?pagelen=50`);
  if (!data) throw new Error(`No encuentro ${ws}/${repo} en Bitbucket.`);
  const origin = `https://bitbucket.org/${ws}/${repo}`;
  const vals = data.values || [];
  const bm = await getJson(`https://api.bitbucket.org/2.0/repositories/${ws}/${repo}`).catch(() => null);
  const res = mk({ kind: 'bitbucket', iconUrl: (bm && bm.links && bm.links.avatar && bm.links.avatar.href) || '', input: origin, title: `${ws}/${repo}`, repoUrl: origin, version: vals[0] ? vals[0].created_on.slice(0, 10) : '', date: vals[0]?.created_on || '' });
  res.assets = buildAssets(vals.map((v) => ({ name: v.name, url: v.links.self.href, size: v.size, rev: `${v.created_on}#${v.size}`, version: v.created_on.slice(0, 10), date: v.created_on })), { origin });
  return res;
}

/* ---------- SourceForge ---------- */
async function sourceforgeFlow(u) {
  const m = /^\/(?:projects|p)\/([^/]+)(?:\/files(\/.*))?/.exec(u.pathname);
  if (!m) return null;
  const sub = m[2] && m[2] !== '/' ? m[2].replace(/\/download$/, '') : '/';
  const res0 = await http(`https://sourceforge.net/projects/${m[1]}/rss?path=${encodeURI(sub)}&limit=100`);
  if (!res0.ok) throw new Error(`No encuentro el proyecto ${m[1]} en SourceForge.`);
  const xml = await res0.text();
  const raws = [];
  for (const it of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = it[1];
    const title = (/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(b) || [])[1] || '';
    const link = ((/<link>([\s\S]*?)<\/link>/.exec(b) || [])[1] || '').trim();
    const date = ((/<pubDate>([\s\S]*?)<\/pubDate>/.exec(b) || [])[1] || '').trim();
    const size = +((/filesize="(\d+)"/.exec(b) || [])[1] || 0);
    if (title && link) raws.push({ name: title.trim().split('/').pop(), url: link, size, rev: date, version: date.slice(5, 16), date });
  }
  const origin = `https://sourceforge.net/projects/${m[1]}/`;
  const res = mk({ kind: 'sourceforge', iconUrl: `https://sourceforge.net/p/${m[1]}/icon`, input: origin, title: m[1], repoUrl: origin, version: raws[0]?.version || '', date: raws[0]?.date || '' });
  res.assets = buildAssets(raws, { origin });
  return res;
}

/* ---------- archivo directo ---------- */
async function directFlow(u, ctx, forcedName) {
  let name = forcedName || fileNameFromUrl(u.href);
  let size = 0, rev = '', date = '';
  try {
    const r = await http(u.href, { method: 'HEAD', timeout: 10000 });
    if (r.ok) {
      size = +r.headers.get('content-length') || 0;
      date = r.headers.get('last-modified') || '';
      rev = r.headers.get('etag') || date || (size ? String(size) : '');
      const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('content-disposition') || '');
      if (cd && !forcedName && !classifyAsset(name)) name = decodeURIComponent(cd[1]);
    }
  } catch { /* HEAD no soportado: seguimos */ }
  const res = mk({ kind: 'direct', iconUrl: u.hostname === 'raw.githubusercontent.com' ? `https://github.com/${u.pathname.split('/')[1]}.png?size=128` : '', input: u.href, title: name || u.hostname, repoUrl: u.href, version: date ? new Date(date).toISOString().slice(0, 10) : '', date });
  res.assets = buildAssets([{ name, url: u.href, size, rev, version: res.version }], { origin: u.href });
  return res;
}

/* ---------- página cualquiera ---------- */
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"').replace(/&#x2F;/g, '/');
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function extractLinks(html, baseHref) {
  const out = new Map();
  const add = (href, text = '') => {
    try {
      const abs = new URL(decodeEntities(String(href)).trim(), baseHref);
      if (!/^https?:$/.test(abs.protocol)) return;
      abs.hash = '';
      if (!out.has(abs.href)) out.set(abs.href, text);
    } catch { /* href inválido */ }
  };
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) add(m[1] ?? m[2] ?? m[3], stripTags(m[4] || ''));
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^\s"'<>)]+?\.(?:AppImage|sh|run|deb|rpm|flatpak|snap|tar\.gz|tar\.xz|tar\.zst|tar\.bz2|tgz|zip|jar)(?=[\s"'<>)\\?#]|$)/gi)) add(m[0].replace(/\\\//g, '/'));
  return out;
}

function forgeKey(href) {
  try {
    const u = new URL(href);
    const h = u.hostname.replace(/^www\./, '');
    const s = u.pathname.split('/').filter(Boolean);
    if (h === 'github.com' && s.length >= 2 && !NOT_REPO_OWNERS.has(s[0].toLowerCase()) && !/^(repos|orgs)$/.test(s[0])) return `https://github.com/${s[0]}/${s[1].replace(/\.git$/, '')}`;
    if (h === 'gitlab.com' && s.length >= 2 && !s[0].startsWith('-') && s[0] !== 'explore') return `https://gitlab.com/${s.slice(0, s.indexOf('-') > 0 ? s.indexOf('-') : 2).join('/')}`;
    if (h === 'codeberg.org' && s.length >= 2) return `https://codeberg.org/${s[0]}/${s[1]}`;
    if (h === 'bitbucket.org' && s.length >= 2 && s[0] !== 'account') return `https://bitbucket.org/${s[0]}/${s[1]}`;
    if (h === 'sourceforge.net' && /^(projects|p)$/.test(s[0] || '') && s[1]) return `https://sourceforge.net/projects/${s[1]}/`;
  } catch { /* nada */ }
  return null;
}

async function pageFlow(u, ctx, page) {
  const html = page.text;
  const title = stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '') || u.hostname;
  const links = extractLinks(html, page.final);
  const origin = u.href;
  const raws = [];
  const forge = new Map();
  for (const [href, text] of links) {
    const name = fileNameFromUrl(href);
    if (classifyAsset(name)) raws.push({ name, url: href, via: 'esta página', origin });
    const k = forgeKey(href);
    if (k) {
      const f = forge.get(k) || { n: 0, releases: false, hint: false };
      f.n++; f.releases = f.releases || /\/releases|\/downloads|\/files/.test(href);
      f.hint = f.hint || /download|descarg|release|linux|appimage/i.test(text);
      forge.set(k, f);
    }
  }
  const favRaw = (/<link[^>]+rel=["'](?:apple-touch-icon(?:-precomposed)?)["'][^>]*>/i.exec(html) || /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i.exec(html) || [])[0] || '';
  const favHref = (/href=["']([^"']+)["']/i.exec(favRaw) || [])[1];
  let favicon = '';
  try { favicon = new URL(favHref ? decodeEntities(favHref) : '/favicon.ico', page.final).href; } catch { /* nada */ }
  const res = mk({ kind: 'page', input: origin, title, repoUrl: origin, iconUrl: favicon });
  res.assets = buildAssets(raws.slice(0, 120), { origin });
  const direct = res.assets.length;
  const picks = [...forge.entries()]
    .filter(([, f]) => (direct ? f.releases : true))
    .sort((a, b) => (b[1].hint - a[1].hint) || (b[1].n - a[1].n))
    .slice(0, 3).map(([k]) => k);
  const subs = await Promise.allSettled(picks.map((k) => detectCore(k, { ...ctx, light: true, _depth: 1 })));
  subs.forEach((s, i) => {
    if (s.status !== 'fulfilled') return;
    const via = picks[i].replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    const idx = s.value.iconUrl ? res.iconUrls.push(s.value.iconUrl) - 1 : -1;
    s.value.assets.forEach((a) => { a.via = via; if (idx >= 0) a.iconIdx = idx; res.assets.push(a); });
    if (!res.version && s.value.version) res.version = s.value.version;
  });
  if (res.assets.length) res.notes.push('Detecté los enlaces dentro de la página' + (picks.length ? ' y seguí los repos que menciona.' : '.'));
  else res.notes.push('La página parece cargar su contenido con JavaScript. Pega el enlace del repo o del archivo.');
  return res;
}

/* ---------- punto de entrada ---------- */
async function detectCore(input, ctx = {}) {
  const u = normalizeInput(input);
  if (!u) throw new Error('Eso no parece un enlace ni un usuario/repo.');
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  let res = null;
  if (/(^|\.)githubusercontent\.com$/.test(host)) res = await directFlow(u, ctx);
  else if (host === 'github.com') res = await githubFlow(u, ctx);
  else if (host === 'gitlab.com') res = await gitlabFlow(u, ctx);
  else if (host === 'codeberg.org') res = await giteaFlow(u, ctx);
  else if (host === 'bitbucket.org') res = await bitbucketFlow(u, ctx);
  else if (host === 'sourceforge.net') res = await sourceforgeFlow(u, ctx);
  if (res) return finish(res);

  if (!res && classifyAsset(fileNameFromUrl(u.href))) return finish(await directFlow(u, ctx));
  if (ctx._depth) throw new Error('Sin resultados');

  const segs = u.pathname.split('/').filter(Boolean);
  if (!res && segs.length >= 2 && segs.length <= 8 && host !== 'github.com') {
    const [g, t] = await Promise.allSettled([giteaFlow(u, ctx), gitlabFlow(u, ctx)]);
    const hit = [g, t].find((x) => x.status === 'fulfilled' && x.value && x.value.assets.length);
    if (hit) return finish(hit.value);
  }
  const resP = await http(u.href, { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
  if (!resP.ok) throw new Error(`La página respondió ${resP.status}.`);
  const type = (resP.headers.get('content-type') || '').toLowerCase();
  const cd = resP.headers.get('content-disposition') || '';
  const final = resP.url || u.href;
  if (/attachment/i.test(cd) || (type && !/text\/|json|xml|javascript/.test(type))) {
    try { await resP.body.cancel(); } catch { /* nada */ }
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : fileNameFromUrl(final) || 'descarga';
    return finish(await directFlow(new URL(final), ctx, name));
  }
  const text = await readLimited(resP, 3_000_000);
  if (/^#!/.test(text)) {
    const py = /^#!.*python/.test(text);
    let name = fileNameFromUrl(final) || (py ? 'script.py' : 'script.sh');
    if (!classifyAsset(name)) name += py ? '.py' : '.sh';
    return finish(await directFlow(new URL(final), ctx, name));
  }
  return finish(await pageFlow(u, ctx, { text, final }));
}

async function detect(input, ctx = {}) {
  const res = await detectCore(input, ctx);
  if (!ctx.light) {
    const [main, ...extra] = await Promise.all([fetchIcon(res.iconUrl), ...res.iconUrls.map(fetchIcon)]);
    res.icon = main; res.icons = extra;
  }
  return res;
}

/** Elige, entre los assets de una detección, el que corresponde a un item ya instalado. */
function pickForItem(assets, item) {
  let re = null;
  try { re = new RegExp(item.pattern, 'i'); } catch { /* patrón inválido */ }
  const same = assets.filter((a) => a.type === item.type && a.compatible);
  const hit = same.filter((a) => re && re.test(a.name)).sort((a, b) => b.score - a.score)[0];
  if (hit) return hit;
  return same.length === 1 ? same[0] : null;
}

module.exports = { detect, normalizeInput, extractLinks, forgeKey, pickForItem };
