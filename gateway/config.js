import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPlainObject as isRecord } from '../json-safe.js';

export const heartbeatSeconds = 60;
export const maxNotificationTextLength = 4000;

const defaultCatchUpMinutes = 720;
const defaultScriptTimeoutMs = 10_000;

export function readManifest(path) {
  const { startupScripts = [], scripts, catchUpMinutes = defaultCatchUpMinutes, scriptTimeoutMs = defaultScriptTimeoutMs } =
    JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(scripts) || !Array.isArray(startupScripts)) {
    throw new Error('scripts and startupScripts must be arrays');
  }
  if (!Number.isSafeInteger(catchUpMinutes) || catchUpMinutes < 0) {
    throw new Error('catchUpMinutes must be a nonnegative integer');
  }
  if (!Number.isInteger(scriptTimeoutMs) || scriptTimeoutMs < 1 || scriptTimeoutMs > 2_147_483_647) {
    throw new Error('scriptTimeoutMs must be a positive integer within the timer range');
  }
  const directory = dirname(path);
  const scriptUrl = (relativePath) => {
    if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) {
      throw new Error('Script paths must be relative to the manifest');
    }
    return pathToFileURL(resolve(directory, relativePath)).href;
  };

  function readScript(entry) {
    if (typeof entry === 'string') return { url: scriptUrl(entry), inject: null };
    if (!isRecord(entry)) throw new Error('An entry in scripts must be a path or an object with a path');

    const { path: relativePath, inject = {} } = entry;
    const url = scriptUrl(relativePath);
    if (!isRecord(inject)) throw new Error(`inject for ${relativePath} must be an object`);
    const bindings = Object.entries(inject);
    for (const [alias, statePath] of bindings) {
      if (!alias || !Array.isArray(statePath) || statePath.length === 0
        || statePath.some((key) => typeof key !== 'string' || !key)) {
        throw new Error(`inject for ${relativePath} must map names to [partId, ...stateKeys]`);
      }
    }
    return { url, inject: bindings };
  }

  return {
    initializers: startupScripts.map(scriptUrl),
    scripts: scripts.map(readScript),
    catchUpMinutes,
    scriptTimeoutMs,
  };
}
