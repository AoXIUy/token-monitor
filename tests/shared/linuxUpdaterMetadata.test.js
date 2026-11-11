'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { resolveFiles, findFile, parseUpdateInfo } = require('electron-updater/out/providers/Provider');
const { mergeLinuxUpdaterMetadata } = require('../../scripts/merge-linux-updater-metadata');

function metadata(extension, version = '0.91.1') {
  const arch = extension === 'deb' ? 'amd64' : 'x86_64';
  const name = `Token-Monitor-${version}-${arch}.${extension}`;
  const bytes = Buffer.from(name);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  return yaml.dump({ version, files: [{ url: name, size: bytes.length, sha512 }], path: name, sha512,
    releaseDate: '2026-11-11T00:00:00.000Z', releaseNotes: 'Conversation switch and Linux packages' });
}

test('one Linux feed lets the actual updater resolve AppImage and Debian independently', () => {
  const contents = mergeLinuxUpdaterMetadata(metadata('AppImage'), metadata('deb'));
  const url = new URL('https://github.com/AoXIUy/token-monitor/releases/download/v0.91.1/');
  const info = parseUpdateInfo(contents, 'latest-linux.yml', url);
  const files = resolveFiles(info, url);
  assert.equal(findFile(files, 'AppImage', ['deb']).url.pathname.split('/').at(-1), 'Token-Monitor-0.91.1-x86_64.AppImage');
  assert.equal(findFile(files, 'deb', ['AppImage', 'rpm', 'pacman']).url.pathname.split('/').at(-1), 'Token-Monitor-0.91.1-amd64.deb');
  assert.equal(info.path, 'Token-Monitor-0.91.1-x86_64.AppImage');
  assert.equal(info.sha512, info.files[0].sha512);
  assert.equal(info.releaseNotes, 'Conversation switch and Linux packages');
});

test('Linux feed merger refuses mismatched versions and stale primary paths or hashes', () => {
  assert.throws(() => mergeLinuxUpdaterMetadata(metadata('AppImage'), metadata('deb', '0.91.0')), /versions differ/);
  for (const change of [{ path: 'old.AppImage' }, { sha512: 'wrong-hash' }]) {
    const image = yaml.load(metadata('AppImage'));
    Object.assign(image, change);
    assert.throws(() => mergeLinuxUpdaterMetadata(yaml.dump(image), metadata('deb')), /path or hash/);
  }
});

test('Linux feed merger refuses missing files or files from the wrong package format', () => {
  assert.throws(() => mergeLinuxUpdaterMetadata(metadata('deb'), metadata('deb')), /Invalid AppImage updater file/);
  assert.throws(() => mergeLinuxUpdaterMetadata(metadata('AppImage'), 'version: 0.91.1\nfiles: []\n'), /Invalid deb updater metadata/);
});
