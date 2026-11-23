// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const stateDb = require('./stateDb');

/**
 * Generate a fresh VS Code / Antigravity device fingerprint profile matching device.rs.
 * @returns {{ machineId: string, macMachineId: string, devDeviceId: string, sqmId: string }}
 */
function generateDeviceProfile() {
  return {
    machineId: `auth0|user_${crypto.randomBytes(16).toString('hex')}`,
    macMachineId: crypto.randomUUID(),
    devDeviceId: crypto.randomUUID(),
    sqmId: `{${crypto.randomUUID().toUpperCase()}}`
  };
}

/**
 * Resolve storage.json path matching device.rs.
 * @param {string | null} [targetIde]
 * @param {{ platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv, userDataDir?: string | null, executablePath?: string | null }} [deps]
 */
function getStoragePath(targetIde = null, deps = {}) {
  const platform = deps.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const dbCandidates = stateDb.getAllCandidateDbPaths(targetIde, deps);
  const storageCandidates = dbCandidates.map((p) => pathApi.join(pathApi.dirname(p), 'storage.json'));
  for (const p of storageCandidates) {
    if (fs.existsSync(p)) return p;
  }
  for (const p of storageCandidates) {
    // Check if the app root dir exists (e.g. ~/.config/Antigravity)
    const appDir = pathApi.dirname(pathApi.dirname(pathApi.dirname(p)));
    if (fs.existsSync(appDir)) return p;
  }
  return storageCandidates[0] || '';
}

/**
 * @param {string} storagePath
 * @returns {{ machineId: string, macMachineId: string, devDeviceId: string, sqmId: string } | null}
 */
function readDeviceProfile(storagePath) {
  try {
    if (!storagePath || !fs.existsSync(storagePath)) return null;
    const rawText = fs.readFileSync(storagePath, 'utf8').replace(/^\uFEFF/, '');
    if (!rawText.trim()) return null;
    const json = JSON.parse(rawText);
    const telemetry = json?.telemetry && typeof json.telemetry === 'object' ? json.telemetry : {};
    const machineId = String(telemetry.machineId || json['telemetry.machineId'] || '').trim();
    const macMachineId = String(telemetry.macMachineId || json['telemetry.macMachineId'] || '').trim();
    const devDeviceId = String(telemetry.devDeviceId || json['telemetry.devDeviceId'] || '').trim();
    const sqmId = String(telemetry.sqmId || json['telemetry.sqmId'] || '').trim();
    if (!machineId && !macMachineId && !devDeviceId && !sqmId) return null;
    return { machineId, macMachineId, devDeviceId, sqmId };
  } catch (_) {
    return null;
  }
}

/**
 * Write profile into storage.json (both nested telemetry object and flat keys)
 * and sync `storage.serviceMachineId` to sibling state.vscdb if present.
 *
 * @param {string} storagePath
 * @param {{ machineId: string, macMachineId: string, devDeviceId: string, sqmId: string }} profile
 * @param {{ sqlite?: any }} [deps]
 */
function writeDeviceProfile(storagePath, profile, deps = {}) {
  if (!storagePath) throw new Error('storage.json path is empty');
  let json = {};
  if (fs.existsSync(storagePath)) {
    const rawText = fs.readFileSync(storagePath, 'utf8').replace(/^\uFEFF/, '');
    json = rawText.trim() ? JSON.parse(rawText) : {};
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('storage.json top-level is not an object');
    }
  } else {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  }

  if (!json.telemetry || typeof json.telemetry !== 'object' || Array.isArray(json.telemetry)) {
    json.telemetry = {};
  }
  json.telemetry.machineId = profile.machineId;
  json.telemetry.macMachineId = profile.macMachineId;
  json.telemetry.devDeviceId = profile.devDeviceId;
  json.telemetry.sqmId = profile.sqmId;

  json['telemetry.machineId'] = profile.machineId;
  json['telemetry.macMachineId'] = profile.macMachineId;
  json['telemetry.devDeviceId'] = profile.devDeviceId;
  json['telemetry.sqmId'] = profile.sqmId;

  const tempPath = `${storagePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, storagePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw error;
  }

  const siblingDb = path.join(path.dirname(storagePath), 'state.vscdb');
  if (fs.existsSync(siblingDb) && profile.devDeviceId) {
    try {
      stateDb.writeItemTableValue(siblingDb, 'storage.serviceMachineId', profile.devDeviceId, deps);
    } catch (_) {}
  }
}

/**
 * Resolve default storage path across Classic & IDE for backup/restore.
 * @param {string | null} [targetIde]
 * @param {{ platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv }} [deps]
 */
function defaultStoragePath(targetIde = null, deps = {}) {
  return getStoragePath(targetIde, {
    platform: deps.platform || process.platform,
    home: deps.home || os.homedir(),
    env: deps.env || process.env
  });
}

module.exports = {
  defaultStoragePath,
  generateDeviceProfile,
  getStoragePath,
  readDeviceProfile,
  writeDeviceProfile
};
