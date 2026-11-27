'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function resolveOpensslBin() {
  const fromEnv = typeof process.env.OPENSSL_BIN === 'string' ? process.env.OPENSSL_BIN.trim() : '';
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const probe = spawnSync('openssl', ['version'], { stdio: 'ignore', windowsHide: true });
  if (!probe.error && probe.status === 0) {
    return 'openssl';
  }

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates = [
      path.win32.join(programFiles, 'Git', 'usr', 'bin', 'openssl.exe'),
      path.win32.join(programFiles, 'Git', 'mingw64', 'bin', 'openssl.exe'),
      path.win32.join(programFilesX86, 'Git', 'usr', 'bin', 'openssl.exe'),
      path.win32.join(programFiles, 'OpenSSL-Win64', 'bin', 'openssl.exe'),
      path.win32.join(programFilesX86, 'OpenSSL-Win32', 'bin', 'openssl.exe')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return 'openssl';
}

const OPENSSL_BIN = resolveOpensslBin();

module.exports = { OPENSSL_BIN, resolveOpensslBin };
