#!/usr/bin/env node
// Downloads the embedded PostgreSQL build and compiles Redis from source
// into resources/. Idempotent: a directory whose .fetch-marker matches the
// pinned version is left untouched. Pass --force to re-download.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESOURCES_PATH = path.join(PACKAGE_ROOT, 'resources');

// theseus-rs builds ship the full client toolset (psql, pg_isready, createdb)
// plus contrib, which setup-db.js needs (uuid-ossp, unaccent), and use
// @loader_path rpaths so the tree is relocatable anywhere in the .app bundle.
const POSTGRES_VERSION = process.env.POSTGRES_VERSION ?? '16.15.0';
const REDIS_VERSION = process.env.REDIS_VERSION ?? '7.4.11';
// Must match the ABI the server's native addons ship prebuilds for (Node 24,
// like the docker image). Electron's embedded node reports its own ABI, under
// which those prebuilds do not load — so the app bundles a real node binary.
const NODE_VERSION = process.env.NODE_VERSION ?? '24.18.1';

const POSTGRES_ARCHITECTURE =
  process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';

const REDIS_HASHES_URL =
  'https://raw.githubusercontent.com/redis/redis-hashes/master/README';

const force = process.argv.includes('--force');
const skipPostgres = process.argv.includes('--skip-postgres');
const skipRedis = process.argv.includes('--skip-redis');
const skipNode = process.argv.includes('--skip-node');

const log = (message) => console.log(`[fetch-binaries] ${message}`);

const fail = (message) => {
  console.error(`[fetch-binaries] ${message}`);
  process.exit(1);
};

const download = async (url) => {
  const response = await fetch(url, { redirect: 'follow' });

  if (!response.ok) {
    fail(`Download failed (${response.status}): ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });

  if (result.status !== 0) {
    fail(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
};

const isMarkerUpToDate = (directoryPath, marker) =>
  !force &&
  existsSync(path.join(directoryPath, '.fetch-marker')) &&
  readFileSync(path.join(directoryPath, '.fetch-marker'), 'utf8').trim() ===
    marker;

const fetchPostgres = async () => {
  const targetPath = path.join(RESOURCES_PATH, 'postgres');
  const marker = `postgresql-${POSTGRES_VERSION}-${POSTGRES_ARCHITECTURE}`;

  if (isMarkerUpToDate(targetPath, marker)) {
    log(`PostgreSQL ${POSTGRES_VERSION} already fetched, skipping`);

    return;
  }

  const versionedName = `postgresql-${POSTGRES_VERSION}-${POSTGRES_ARCHITECTURE}`;
  const baseUrl = `https://github.com/theseus-rs/postgresql-binaries/releases/download/${POSTGRES_VERSION}`;
  const workDirectoryPath = mkdtempSync(path.join(tmpdir(), 'twenty-pg-'));

  log(`Downloading PostgreSQL ${POSTGRES_VERSION} (${POSTGRES_ARCHITECTURE})…`);
  const archive = await download(`${baseUrl}/${versionedName}.tar.gz`);
  const expectedChecksum = (
    await download(`${baseUrl}/${versionedName}.tar.gz.sha256`)
  )
    .toString('utf8')
    .trim()
    .split(/\s+/)[0];

  if (sha256(archive) !== expectedChecksum) {
    fail('PostgreSQL archive checksum mismatch');
  }

  writeFileSync(path.join(workDirectoryPath, 'archive.tar.gz'), archive);
  run('tar', ['-xzf', 'archive.tar.gz'], { cwd: workDirectoryPath });

  const extractedPath = path.join(workDirectoryPath, versionedName);
  const requiredFiles = [
    'bin/postgres',
    'bin/initdb',
    'bin/pg_ctl',
    'bin/psql',
    'share/extension/uuid-ossp.control',
    'share/extension/unaccent.control',
  ];

  for (const requiredFile of requiredFiles) {
    if (!existsSync(path.join(extractedPath, requiredFile))) {
      fail(`PostgreSQL build is missing ${requiredFile}`);
    }
  }

  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(targetPath, { recursive: true });
  cpSync(extractedPath, targetPath, { recursive: true });

  for (const binaryName of readdirSync(path.join(targetPath, 'bin'))) {
    chmodSync(path.join(targetPath, 'bin', binaryName), 0o755);
  }

  writeFileSync(path.join(targetPath, '.fetch-marker'), marker);
  rmSync(workDirectoryPath, { recursive: true, force: true });
  log(`PostgreSQL ${POSTGRES_VERSION} installed at ${targetPath}`);
};

const fetchRedis = async () => {
  const targetPath = path.join(RESOURCES_PATH, 'redis');
  const marker = `redis-${REDIS_VERSION}`;

  if (isMarkerUpToDate(targetPath, marker)) {
    log(`Redis ${REDIS_VERSION} already fetched, skipping`);

    return;
  }

  log(`Fetching Redis ${REDIS_VERSION} checksum…`);
  const hashesContent = (await download(REDIS_HASHES_URL)).toString('utf8');
  const hashLine = hashesContent
    .split('\n')
    .find((line) => line.includes(`redis-${REDIS_VERSION}.tar.gz`));

  if (!hashLine) {
    fail(`No published checksum for redis-${REDIS_VERSION}.tar.gz`);
  }

  const expectedChecksum = hashLine.match(/\b[a-f0-9]{64}\b/)?.[0];

  if (!expectedChecksum) {
    fail('Could not parse the Redis checksum entry');
  }

  for (const command of ['cc', 'make']) {
    const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });

    if (probe.error) {
      fail(
        `Building Redis requires ${command} (install Xcode Command Line Tools: xcode-select --install)`,
      );
    }
  }

  log(`Downloading Redis ${REDIS_VERSION}…`);
  const archive = await download(
    `https://download.redis.io/releases/redis-${REDIS_VERSION}.tar.gz`,
  );

  if (sha256(archive) !== expectedChecksum) {
    fail('Redis archive checksum mismatch');
  }

  const workDirectoryPath = mkdtempSync(path.join(tmpdir(), 'twenty-redis-'));
  const archivePath = path.join(workDirectoryPath, 'redis.tar.gz');

  writeFileSync(archivePath, archive);
  run('tar', ['-xzf', 'redis.tar.gz'], { cwd: workDirectoryPath });

  log('Compiling redis-server (about a minute)…');
  run('make', ['-j', String(cpus().length), 'redis-server'], {
    cwd: path.join(workDirectoryPath, `redis-${REDIS_VERSION}`),
    env: { ...process.env, MALLOC_ARENA_MAX: '2' },
  });

  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(targetPath, { recursive: true });
  cpSync(
    path.join(
      workDirectoryPath,
      `redis-${REDIS_VERSION}`,
      'src',
      'redis-server',
    ),
    path.join(targetPath, 'redis-server'),
  );
  chmodSync(path.join(targetPath, 'redis-server'), 0o755);

  writeFileSync(path.join(targetPath, '.fetch-marker'), marker);
  rmSync(workDirectoryPath, { recursive: true, force: true });
  log(`Redis ${REDIS_VERSION} installed at ${targetPath}`);
};

const fetchNode = async () => {
  const targetPath = path.join(RESOURCES_PATH, 'node');
  const osArchitecture = process.arch === 'arm64' ? 'arm64' : 'x64';
  const versionedName = `node-v${NODE_VERSION}-darwin-${osArchitecture}`;
  const marker = versionedName;

  if (isMarkerUpToDate(targetPath, marker)) {
    log(`Node ${NODE_VERSION} already fetched, skipping`);

    return;
  }

  log(`Downloading Node ${NODE_VERSION}…`);
  const shasums = (
    await download(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)
  ).toString('utf8');
  const expectedChecksum = shasums
    .split('\n')
    .find((line) => line.includes(`${versionedName}.tar.gz`))
    ?.match(/\b[a-f0-9]{64}\b/)?.[0];

  if (!expectedChecksum) {
    fail(`No published checksum for ${versionedName}.tar.gz`);
  }

  const archive = await download(
    `https://nodejs.org/dist/v${NODE_VERSION}/${versionedName}.tar.gz`,
  );

  if (sha256(archive) !== expectedChecksum) {
    fail('Node archive checksum mismatch');
  }

  const workDirectoryPath = mkdtempSync(path.join(tmpdir(), 'twenty-node-'));

  writeFileSync(path.join(workDirectoryPath, 'archive.tar.gz'), archive);
  run('tar', ['-xzf', 'archive.tar.gz'], { cwd: workDirectoryPath });

  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(targetPath, { recursive: true });
  // Only the runtime binary is needed; npm/corepack never run inside the app.
  cpSync(
    path.join(workDirectoryPath, versionedName, 'bin', 'node'),
    path.join(targetPath, 'node'),
  );
  chmodSync(path.join(targetPath, 'node'), 0o755);

  writeFileSync(path.join(targetPath, '.fetch-marker'), marker);
  rmSync(workDirectoryPath, { recursive: true, force: true });
  log(`Node ${NODE_VERSION} installed at ${targetPath}`);
};

const main = async () => {
  mkdirSync(RESOURCES_PATH, { recursive: true });

  if (!skipPostgres) {
    await fetchPostgres();
  }

  if (!skipRedis) {
    await fetchRedis();
  }

  if (!skipNode) {
    await fetchNode();
  }
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
