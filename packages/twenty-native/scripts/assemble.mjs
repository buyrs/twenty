#!/usr/bin/env node
// Assembles resources/app-runtime: the compiled twenty-server with the
// frontend baked into dist/front plus production node_modules, mirroring the
// runtime layers of the docker image (packages/twenty-docker/twenty/Dockerfile,
// "twenty" target) so relative module resolution behaves identically.
//
// The production install runs inside the staged bundle itself, as a minimal
// standalone yarn project — never in the repository, where pruning dev
// dependencies would break yarn.config.cjs.
//
// Env switches for iteration: TWENTY_NATIVE_SKIP_FRONT_BUILD,
// TWENTY_NATIVE_SKIP_SERVER_BUILD.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(path.dirname(PACKAGE_ROOT));
const RESOURCES_PATH = path.join(PACKAGE_ROOT, 'resources');
const APP_RUNTIME_PATH = path.join(RESOURCES_PATH, 'app-runtime');

const SERVER_PACKAGE_NAME = 'twenty-server';
const WORKSPACE_PACKAGE_NAMES = [
  'twenty-shared',
  'twenty-emails',
  'twenty-client-sdk',
];

const log = (message) => console.log(`[assemble] ${message}`);

const fail = (message) => {
  console.error(`[assemble] ${message}`);
  process.exit(1);
};

const run = (command, args, options = {}) => {
  log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    ...options,
  });

  if (result.status !== 0) {
    fail(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
};

const assertFetchedBinaries = () => {
  for (const binaryPath of [
    path.join(RESOURCES_PATH, 'postgres', 'bin', 'postgres'),
    path.join(RESOURCES_PATH, 'redis', 'redis-server'),
    path.join(RESOURCES_PATH, 'node', 'node'),
  ]) {
    if (!existsSync(binaryPath)) {
      fail(
        `Missing ${binaryPath}. Run \`yarn native:build\` (fetch step) first.`,
      );
    }
  }
};

const buildWorkspace = () => {
  if (!process.env.TWENTY_NATIVE_SKIP_SERVER_BUILD) {
    // twenty-shared/dist is per-branch state nothing tracks; build it fresh
    // or dependent typechecks/builds trust stale output.
    run('yarn', ['nx', 'build', 'twenty-shared', '--skip-nx-cache']);
    // Compiled catalogs are runtime input for the server; extract is skipped
    // on purpose so the committed .po files do not churn.
    run('yarn', ['nx', 'run', 'twenty-emails:lingui:compile']);
    run('yarn', ['nx', 'run', 'twenty-server:lingui:compile']);
    run('yarn', ['nx', 'build', 'twenty-server', '--skip-nx-cache']);
  } else {
    log('Skipping server build (TWENTY_NATIVE_SKIP_SERVER_BUILD)');
  }

  if (!process.env.TWENTY_NATIVE_SKIP_FRONT_BUILD) {
    run('yarn', ['nx', 'run', 'twenty-front:lingui:compile']);
    run('yarn', ['nx', 'build', 'twenty-front', '--skip-nx-cache'], {
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim(),
      },
    });
  } else {
    log('Skipping front build (TWENTY_NATIVE_SKIP_FRONT_BUILD)');
  }
};

// The runtime ships no type declarations, source maps, or test output.
const isRuntimeFileNeeded = (sourcePath, basePath) => {
  const relativePath = path.relative(basePath, sourcePath);

  if (relativePath.endsWith('.d.ts') || relativePath.endsWith('.map')) {
    return false;
  }

  if (/(^|[\\/])tests?[\\/]/.test(relativePath)) {
    return false;
  }

  return !/\.(spec|test|e2e-spec)\.[jt]s$/.test(relativePath);
};

const copyFiltered = (sourcePath, destinationPath, filter) => {
  cpSync(sourcePath, destinationPath, {
    recursive: true,
    filter: (candidatePath) => filter(candidatePath, sourcePath),
  });
};

const stageServerPackage = () => {
  const sourcePath = path.join(REPO_ROOT, 'packages', SERVER_PACKAGE_NAME);
  const destinationPath = path.join(
    APP_RUNTIME_PATH,
    'packages',
    SERVER_PACKAGE_NAME,
  );

  if (!existsSync(path.join(sourcePath, 'dist', 'main.js'))) {
    fail('twenty-server has no dist/main.js; build it first');
  }

  mkdirSync(path.join(destinationPath), { recursive: true });

  for (const entryName of ['package.json', 'patches', 'scripts']) {
    const entryPath = path.join(sourcePath, entryName);

    if (existsSync(entryPath)) {
      cpSync(entryPath, path.join(destinationPath, entryName), {
        recursive: true,
      });
    }
  }

  copyFiltered(
    path.join(sourcePath, 'dist'),
    path.join(destinationPath, 'dist'),
    isRuntimeFileNeeded,
  );

  const frontBuildPath = path.join(
    REPO_ROOT,
    'packages',
    'twenty-front',
    'build',
  );

  if (!existsSync(frontBuildPath)) {
    fail('twenty-front has no build/ output; build it first');
  }

  // Same placement as the docker image: ServeStaticModule picks dist/front up.
  cpSync(frontBuildPath, path.join(destinationPath, 'dist', 'front'), {
    recursive: true,
  });

  log(`Staged ${SERVER_PACKAGE_NAME}`);
};

const stageWorkspacePackages = () => {
  for (const packageName of WORKSPACE_PACKAGE_NAMES) {
    const sourcePath = path.join(REPO_ROOT, 'packages', packageName);
    const destinationPath = path.join(
      APP_RUNTIME_PATH,
      'packages',
      packageName,
    );

    if (!existsSync(path.join(sourcePath, 'dist'))) {
      fail(`${packageName} has no dist/ output; build it first`);
    }

    mkdirSync(destinationPath, { recursive: true });
    cpSync(
      path.join(sourcePath, 'package.json'),
      path.join(destinationPath, 'package.json'),
    );
    copyFiltered(
      path.join(sourcePath, 'dist'),
      path.join(destinationPath, 'dist'),
      isRuntimeFileNeeded,
    );

    log(`Staged ${packageName}`);
  }
};

const stageNodeModules = () => {
  const rootPackageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  );
  const yarnReleasePath = readFileSync(
    path.join(REPO_ROOT, '.yarnrc.yml'),
    'utf8',
  ).match(/^yarnPath:\s*(\S+)/m)?.[1];

  if (!yarnReleasePath) {
    fail('Could not read yarnPath from .yarnrc.yml');
  }

  writeFileSync(
    path.join(APP_RUNTIME_PATH, 'package.json'),
    JSON.stringify(
      {
        name: 'twenty-app-runtime',
        private: true,
        workspaces: ['packages/*'],
        // Same resolutions as the repository so the copied lockfile resolves
        // to the same graph, patches included.
        resolutions: rootPackageJson.resolutions,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(APP_RUNTIME_PATH, '.yarnrc.yml'),
    'nodeLinker: node-modules\nenableScripts: false\n',
  );
  cpSync(
    path.join(REPO_ROOT, 'yarn.lock'),
    path.join(APP_RUNTIME_PATH, 'yarn.lock'),
  );
  cpSync(
    path.join(REPO_ROOT, '.yarn', 'patches'),
    path.join(APP_RUNTIME_PATH, '.yarn', 'patches'),
    { recursive: true },
  );

  run(
    'node',
    [
      path.join(REPO_ROOT, yarnReleasePath),
      'workspaces',
      'focus',
      '--production',
      ...WORKSPACE_PACKAGE_NAMES,
      SERVER_PACKAGE_NAME,
    ],
    { cwd: APP_RUNTIME_PATH },
  );

  // Workspace dependencies are symlinks into packages/; replace them with
  // real directories so the bundle never depends on symlink preservation
  // through electron-builder packaging.
  for (const packageName of [...WORKSPACE_PACKAGE_NAMES, SERVER_PACKAGE_NAME]) {
    const stagedPackagePath = path.join(
      APP_RUNTIME_PATH,
      'packages',
      packageName,
    );
    const linkedPackagePath = path.join(
      APP_RUNTIME_PATH,
      'node_modules',
      packageName,
    );

    rmSync(linkedPackagePath, { force: true, recursive: true });
    mkdirSync(linkedPackagePath, { recursive: true });
    cpSync(
      path.join(stagedPackagePath, 'package.json'),
      path.join(linkedPackagePath, 'package.json'),
    );
    copyFiltered(
      path.join(stagedPackagePath, 'dist'),
      path.join(linkedPackagePath, 'dist'),
      isRuntimeFileNeeded,
    );
  }

  // The yarn metadata was only scaffolding for the pruned install.
  for (const scaffoldEntry of [
    'package.json',
    '.yarnrc.yml',
    'yarn.lock',
    '.yarn',
  ]) {
    rmSync(path.join(APP_RUNTIME_PATH, scaffoldEntry), {
      force: true,
      recursive: true,
    });
  }

  log('Staged node_modules');
};

const directorySizeInMegabytes = (directoryPath) => {
  let totalBytes = 0;

  const walk = (entryPath) => {
    for (const entryName of readdirSync(entryPath)) {
      const childPath = path.join(entryPath, entryName);
      const stats = lstatSync(childPath);

      if (stats.isDirectory()) {
        walk(childPath);
      } else {
        totalBytes += stats.size;
      }
    }
  };

  walk(directoryPath);

  return Math.round(totalBytes / 1e6);
};

const main = () => {
  assertFetchedBinaries();
  buildWorkspace();

  rmSync(APP_RUNTIME_PATH, { recursive: true, force: true });

  stageServerPackage();
  stageWorkspacePackages();
  stageNodeModules();

  log(`app-runtime: ${directorySizeInMegabytes(APP_RUNTIME_PATH)}MB`);
  log('Done');
};

main();
