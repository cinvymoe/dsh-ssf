import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;

export function parseReleaseCheckArgs(args) {
  if (args.length !== 4 || args[0] !== '--manifest-url' || args[2] !== '--expected-version') {
    throw new Error('Usage: verify-marketplace-release --manifest-url <https-url> --expected-version <x.y.z>');
  }
  const parsedUrl = new URL(args[1]);
  if (parsedUrl.protocol !== 'https:') throw new Error('manifest URL must use HTTPS');
  if (!SEMVER.test(args[3])) throw new Error('expected version must use x.y.z semver');
  return { manifestUrl: parsedUrl.href, expectedVersion: args[3] };
}

export async function verifyMarketplaceRelease({
  manifestUrl,
  expectedVersion,
  fetchImpl = globalThis.fetch,
}) {
  let response;
  try {
    response = await fetchImpl(manifestUrl);
  } catch (error) {
    throw new Error('marketplace network request failed: ' + error.message);
  }
  if (!response.ok) throw new Error('marketplace manifest request failed: HTTP ' + response.status);
  let manifest;
  try {
    manifest = await response.json();
  } catch (error) {
    throw new Error('marketplace manifest is not valid JSON: ' + error.message);
  }
  if (typeof manifest.version !== 'string') throw new Error('marketplace manifest is missing a string version');
  if (manifest.version !== expectedVersion) {
    throw new Error('marketplace version mismatch: expected ' + expectedVersion + ', found ' + manifest.version);
  }
  return { manifestUrl, expectedVersion, actualVersion: manifest.version };
}

export async function main(
  args,
  { fetchImpl = globalThis.fetch, stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    const { manifestUrl, expectedVersion } = parseReleaseCheckArgs(args);
    const result = await verifyMarketplaceRelease({ manifestUrl, expectedVersion, fetchImpl });
    stdout.write(`Marketplace manifest verified: ${result.actualVersion} (${result.manifestUrl})\n`);
    return 0;
  } catch (error) {
    stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
