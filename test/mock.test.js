'use strict';
process.env.PH_PLATFORM = 'linux';
// Pruebas con fetch simulado (sin red): GitHub, GitLab, Gitea, SourceForge, página y script suelto.
const assert = require('assert');
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
const T = (t, type = 'text/html') => new Response(t, { headers: { 'content-type': type } });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const routes = {
  'https://api.github.com/repos/o/app': () => J({ description: 'App', default_branch: 'main' }),
  'https://api.github.com/repos/o/app/releases/latest': () => J({ tag_name: 'v2.0.0', published_at: '2026-10-01', assets: [
    { id: 1, name: 'App-2.0.0-x86_64.AppImage', browser_download_url: 'https://gh/dl/a.AppImage', size: 1000, updated_at: 'x' },
    { id: 2, name: 'App-2.0.0-x86_64.AppImage.sha256', browser_download_url: 'https://gh/dl/a.sha', size: 10 },
    { id: 3, name: 'App-2.0.0-windows.exe', browser_download_url: 'https://gh/dl/w.exe', size: 10 },
    { id: 4, name: 'install.sh', browser_download_url: 'https://gh/dl/i.sh', size: 10 }] }),
  'https://api.github.com/repos/o/scripts': () => J({ default_branch: 'main' }),
  'https://api.github.com/repos/o/scripts/releases/latest': () => J({}, 404),
  'https://api.github.com/repos/o/scripts/releases?per_page=5': () => J([]),
  'https://api.github.com/repos/o/scripts/contents': () => J([{ name: 'setup.sh', type: 'file', sha: 'abc1234', download_url: 'https://raw/setup.sh', size: 5 }, { name: 'README.md', type: 'file', download_url: 'x' }, { name: 'main.py', type: 'file', download_url: 'y' }]),
  'https://gitlab.com/api/v4/projects/g%2Fp': () => J({ id: 1, default_branch: 'main', description: 'gl' }),
  'https://gitlab.com/api/v4/projects/g%2Fp/releases?per_page=5': () => J([{ tag_name: '1.0', assets: { links: [{ id: 9, name: 'p-linux-x86_64.tar.gz', direct_asset_url: 'https://gl/p.tar.gz' }] } }]),
  'https://codeberg.org/api/v1/repos/u/r': () => J({ full_name: 'u/r', default_branch: 'main' }),
  'https://codeberg.org/api/v1/repos/u/r/releases?limit=5': () => J([{ tag_name: 'v3', assets: [{ id: 5, name: 'r.AppImage', browser_download_url: 'https://cb/r.AppImage', size: 5 }] }]),
  'https://api.bitbucket.org/2.0/repositories/w/r/downloads?pagelen=50': () => J({ values: [{ name: 'tool.sh', size: 3, created_on: '2026-01-02T00:00:00', links: { self: { href: 'https://bb/tool.sh' } } }] }),
  'https://sourceforge.net/projects/foo/rss?path=/&limit=100': () => T('<rss><item><title><![' + 'CDATA[/v1/foo-1.0.AppImage]]></title><link>https://sourceforge.net/projects/foo/files/v1/foo-1.0.AppImage/download</link><pubDate>Mon, 01 Jan 2026 00:00:00 UT</pubDate></item></rss>', 'text/xml'),
  'https://github.com/o.png?size=128': () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
  'https://site.com/get': () => T('<title>Mi App</title><a href="/dl/app-1.0.AppImage">Linux</a><a href="https://github.com/o/app/releases">GH</a>'),
  'https://site.com/nolinks': () => T('<title>Vacía</title><p>hola</p>'),
  'https://site.com/inst': () => T(['#', '!/usr/bin/env sh\necho hi\n'].join(''), 'text/plain'),
};
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (opts.method === 'HEAD') return new Response(null, { headers: { etag: '"e1"', 'content-length': '10' } });
  if (/\/api\/v1\/repos\/g\/p|api\/v4\/projects\/(?!g%2Fp)/.test(u)) return J({}, 404);
  const r = routes[u];
  if (!r) return J({}, 404);
  return r();
};
const { detect } = require('../lib/detect');
(async () => {
  let r = await detect('o/app');
  assert.strictEqual(r.kind, 'github'); assert.strictEqual(r.version, 'v2.0.0');
  assert.strictEqual(r.assets[0].name, 'App-2.0.0-x86_64.AppImage'); assert.ok(r.assets[0].recommended);
  assert.ok(r.assets[0].sha256Url);
  const exe = r.assets.find((a) => a.name.endsWith('.exe'));
  assert.ok(exe && exe.compatible === false && !exe.recommended, 'un .exe no es compatible en Linux');
  assert.ok(r.assets.some((a) => a.type === 'script'));
  assert.ok(r.icon.startsWith('data:image/png;base64,'), 'icono del repo');
  r = await detect('https://github.com/o/scripts');
  assert.deepStrictEqual(r.assets.map((a) => a.name), ['setup.sh']); assert.ok(r.notes.length);
  r = await detect('https://gitlab.com/g/p'); assert.strictEqual(r.kind, 'gitlab'); assert.strictEqual(r.assets[0].type, 'archive');
  r = await detect('https://codeberg.org/u/r'); assert.strictEqual(r.kind, 'gitea'); assert.strictEqual(r.assets[0].name, 'r.AppImage');
  r = await detect('https://bitbucket.org/w/r'); assert.strictEqual(r.assets[0].name, 'tool.sh');
  r = await detect('https://sourceforge.net/projects/foo/'); assert.strictEqual(r.assets[0].name, 'foo-1.0.AppImage');
  r = await detect('https://site.com/get'); assert.strictEqual(r.kind, 'page');
  assert.ok(r.assets.some((a) => a.url === 'https://site.com/dl/app-1.0.AppImage'));
  assert.ok(r.assets.some((a) => a.via.includes('github.com/o/app')));
  r = await detect('https://site.com/inst'); assert.strictEqual(r.assets[0].type, 'script'); assert.strictEqual(r.assets[0].name, 'inst.sh');
  r = await detect('https://x.com/a/b-1.0.AppImage'); assert.strictEqual(r.kind, 'direct'); assert.strictEqual(r.assets[0].rev, '"e1"');
  await assert.rejects(() => detect('https://site.com/nolinks'), /No encontré descargables/);
  console.log('mock tests OK');
})().catch((e) => { console.error(e); process.exit(1); });
