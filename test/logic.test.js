'use strict';
process.env.PH_PLATFORM = 'linux'; // las pruebas no dependen del sistema donde corren
const assert = require('assert');
const { classifyAsset, assetPattern } = require('../lib/classify');
const { normalizeInput, extractLinks, forgeKey, pickForItem } = require('../lib/detect');

// clasificación
assert.strictEqual(classifyAsset('App-1.2.3-x86_64.AppImage').type, 'appimage');
assert.strictEqual(classifyAsset('install.sh').type, 'script');
assert.strictEqual(classifyAsset('tool.run').type, 'installer');
assert.strictEqual(classifyAsset('foo-1.0-1-x86_64.pkg.tar.zst').type, 'pacman');
assert.strictEqual(classifyAsset('foo-linux-amd64').type, 'binary');
assert.strictEqual(classifyAsset('foo.tar.gz').type, 'archive');
assert.strictEqual(classifyAsset('foo.sha256'), null);
assert.strictEqual(classifyAsset('foo.exe').ok, false);
assert.strictEqual(classifyAsset('foo-windows-x64.zip').ok, false);
assert.strictEqual(classifyAsset('foo-linux-arm64.tar.gz').ok, false);
assert.strictEqual(classifyAsset('foo-linux-x86_64.tar.gz').ok, true);
assert.ok(classifyAsset('a-x86_64.AppImage').score > classifyAsset('a-x86_64.deb').score);

// Windows
const { createClassifier } = require('../lib/classify');
const win = createClassifier('win32', 'x64').classifyAsset;
assert.strictEqual(win('App-Setup-1.0-x64.exe').type, 'exe');
assert.strictEqual(win('App-Setup-1.0-x64.exe').ok, true);
assert.strictEqual(win('tool.msi').type, 'msi');
assert.strictEqual(win('a-x86_64.AppImage').ok, false);
assert.strictEqual(win('app-win32-x64.zip').ok, true);
assert.strictEqual(win('app-linux-x64.zip').ok, false);
assert.strictEqual(win('app-windows-arm64.exe').ok, false);
assert.strictEqual(win('install.ps1').type, 'script');
assert.strictEqual(win('install.ps1').ok, true);
assert.strictEqual(win('install.sh').ok, false);
assert.strictEqual(classifyAsset('App-Setup-1.0-x64.exe').ok, false); // en Linux un .exe no es compatible

// patrón de actualización
const re = new RegExp(assetPattern('App-1.2.3-x86_64.AppImage'), 'i');
assert.ok(re.test('App-1.10.0-x86_64.AppImage'));
assert.ok(!re.test('App-1.2.3-aarch64.AppImage'));

// entradas
assert.strictEqual(normalizeInput('owner/repo').href, 'https://github.com/owner/repo');
assert.strictEqual(normalizeInput('git@github.com:o/r.git').href, 'https://github.com/o/r');
assert.strictEqual(normalizeInput('example.com/dl').href, 'https://example.com/dl');
assert.strictEqual(normalizeInput('   '), null);

// páginas
const html = '<a href="/files/app-2.0.AppImage">Linux</a><a href="https://github.com/o/r/releases">GH</a>';
const links = [...extractLinks(html, 'https://site.com/dl').keys()];
assert.ok(links.includes('https://site.com/files/app-2.0.AppImage'));
assert.strictEqual(forgeKey('https://github.com/o/r/releases/tag/v1'), 'https://github.com/o/r');
assert.strictEqual(forgeKey('https://github.com/features/actions'), null);
assert.strictEqual(forgeKey('https://sourceforge.net/projects/foo/files/x'), 'https://sourceforge.net/projects/foo/');

// pickForItem
const item = { type: 'appimage', pattern: assetPattern('App-1.0.0-x86_64.AppImage') };
const assets = [{ name: 'App-2.0.0-x86_64.AppImage', type: 'appimage', compatible: true, score: 90 }, { name: 'App-2.0.0-aarch64.AppImage', type: 'appimage', compatible: false, score: -5 }];
assert.strictEqual(pickForItem(assets, item).name, 'App-2.0.0-x86_64.AppImage');

// huella de vigilancia
const { signature, watchId } = require('../lib/watch');
const mkRes = (v, revs) => ({ version: v, assets: revs.map((r) => ({ name: 'a' + r, rev: r, compatible: true })) });
assert.strictEqual(signature(mkRes('v1', ['1', '2'])), signature(mkRes('v1', ['2', '1'])));
assert.notStrictEqual(signature(mkRes('v1', ['1'])), signature(mkRes('v2', ['1'])));
assert.notStrictEqual(signature(mkRes('v1', ['1'])), signature(mkRes('v1', ['1', '3'])));
assert.strictEqual(watchId('https://github.com/o/r'), watchId('https://github.com/o/r'));

console.log('logic tests OK');
