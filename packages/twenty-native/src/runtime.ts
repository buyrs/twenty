import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { app } from 'electron';

const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_POSTGRES_PORT = 5433;
const DEFAULT_REDIS_PORT = 6379;
const PORT_SCAN_RANGE = 50;
const SECRET_LENGTH_IN_BYTES = 32;

export type RuntimePaths = {
  bundleResourcesPath: string;
  appRuntimePath: string;
  serverPackagePath: string;
  nodeBinPath: string;
  postgresPrefixPath: string;
  postgresDataPath: string;
  postgresSocketPath: string;
  redisBinPath: string;
  redisDataPath: string;
  storagePath: string;
  logsPath: string;
  stateFilePath: string;
  secretFilePath: string;
};

export type RuntimeConfiguration = {
  paths: RuntimePaths;
  serverPort: number;
  postgresPort: number;
  redisPort: number;
  serverUrl: string;
  appSecret: string;
};

export type NativeAppState = {
  appVersion: string;
  initializedAt: string;
};

// The userData path differs between `electron .` (twenty-native) and the
// packaged app (Twenty); pin it so both read the same on-disk data.
export const resolveUserDataPath = (): string =>
  path.join(app.getPath('appData'), 'Twenty');

export const resolveBundleResourcesPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(app.getAppPath(), 'resources');

export const resolveRuntimePaths = (): RuntimePaths => {
  const userDataPath = resolveUserDataPath();
  const bundleResourcesPath = resolveBundleResourcesPath();
  const appRuntimePath = path.join(bundleResourcesPath, 'app-runtime');

  for (const directoryPath of [
    userDataPath,
    path.join(userDataPath, 'postgres'),
    path.join(userDataPath, 'redis'),
    path.join(userDataPath, 'storage'),
    path.join(userDataPath, 'logs'),
  ]) {
    mkdirSync(directoryPath, { recursive: true });
  }

  return {
    bundleResourcesPath,
    appRuntimePath,
    serverPackagePath: path.join(appRuntimePath, 'packages', 'twenty-server'),
    nodeBinPath: path.join(bundleResourcesPath, 'node', 'node'),
    postgresPrefixPath: path.join(bundleResourcesPath, 'postgres'),
    postgresDataPath: path.join(userDataPath, 'postgres', 'data'),
    postgresSocketPath: path.join(userDataPath, 'postgres'),
    redisBinPath: path.join(bundleResourcesPath, 'redis', 'redis-server'),
    redisDataPath: path.join(userDataPath, 'redis'),
    storagePath: path.join(userDataPath, 'storage'),
    logsPath: path.join(userDataPath, 'logs'),
    stateFilePath: path.join(userDataPath, 'native-app-state.json'),
    secretFilePath: path.join(userDataPath, 'app-secret'),
  };
};

const isPortAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });

export const findAvailablePort = async (
  preferredPort: number,
): Promise<number> => {
  for (
    let candidatePort = preferredPort;
    candidatePort < preferredPort + PORT_SCAN_RANGE;
    candidatePort += 1
  ) {
    if (await isPortAvailable(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(
    `No free port in range ${preferredPort}-${preferredPort + PORT_SCAN_RANGE - 1}`,
  );
};

// APP_SECRET encrypts tokens at rest; regenerating it would invalidate every
// existing session, so it is created once per install and reused.
export const loadOrCreateAppSecret = (secretFilePath: string): string => {
  if (existsSync(secretFilePath)) {
    const existingSecret = readFileSync(secretFilePath, 'utf8').trim();

    if (existingSecret.length > 0) {
      return existingSecret;
    }
  }

  const appSecret = randomBytes(SECRET_LENGTH_IN_BYTES).toString('hex');
  writeFileSync(secretFilePath, appSecret, { mode: 0o600 });

  return appSecret;
};

export const loadNativeAppState = (
  stateFilePath: string,
): NativeAppState | null => {
  if (!existsSync(stateFilePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(stateFilePath, 'utf8')) as NativeAppState;
  } catch {
    return null;
  }
};

export const saveNativeAppState = (
  stateFilePath: string,
  state: NativeAppState,
): void => {
  writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
};

export const resolveRuntimeConfiguration =
  async (): Promise<RuntimeConfiguration> => {
    const paths = resolveRuntimePaths();

    if (!existsSync(paths.serverPackagePath)) {
      throw new Error(
        `Runtime bundle is missing at ${paths.serverPackagePath}. Run \`yarn native:build\` first.`,
      );
    }

    const [serverPort, postgresPort, redisPort] = await Promise.all([
      findAvailablePort(DEFAULT_SERVER_PORT),
      findAvailablePort(DEFAULT_POSTGRES_PORT),
      findAvailablePort(DEFAULT_REDIS_PORT),
    ]);

    return {
      paths,
      serverPort,
      postgresPort,
      redisPort,
      serverUrl: `http://localhost:${serverPort}`,
      appSecret: loadOrCreateAppSecret(paths.secretFilePath),
    };
  };
