import { app, BrowserWindow, dialog, Menu, shell } from 'electron';

import { waitForSuccessfulRequest } from './health';
import { LOADING_SCREEN_HTML, setWindowStatus } from './loading-screen';
import {
  loadNativeAppState,
  resolveRuntimeConfiguration,
  resolveUserDataPath,
  saveNativeAppState,
} from './runtime';
import {
  createPostgresService,
  type PostgresService,
} from './services/postgres';
import { createRedisService, type RedisService } from './services/redis';
import { createTwentyService, type TwentyService } from './services/twenty';

const HEALTH_CHECK_TIMEOUT_MS = 180_000;

let mainWindow: BrowserWindow | null = null;
let postgresService: PostgresService | null = null;
let redisService: RedisService | null = null;
let twentyService: TwentyService | null = null;
let shutdownPromise: Promise<void> | null = null;

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Twenty',
    backgroundColor: '#101319',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);

    return { action: 'deny' };
  });

  void window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(LOADING_SCREEN_HTML)}`,
  );

  return window;
};

const setStatus = (status: string): void => {
  console.log(`[twenty-native] ${status}`);

  if (mainWindow) {
    setWindowStatus(mainWindow, status);
  }
};

const start = async (): Promise<void> => {
  const configuration = await resolveRuntimeConfiguration();

  postgresService = createPostgresService({
    prefixPath: configuration.paths.postgresPrefixPath,
    dataPath: configuration.paths.postgresDataPath,
    socketPath: configuration.paths.postgresSocketPath,
    port: configuration.postgresPort,
    logsPath: configuration.paths.logsPath,
  });

  setStatus('Starting PostgreSQL…');
  await postgresService.start();
  await postgresService.createDatabaseIfMissing();

  redisService = createRedisService({
    binPath: configuration.paths.redisBinPath,
    dataPath: configuration.paths.redisDataPath,
    port: configuration.redisPort,
    logsPath: configuration.paths.logsPath,
  });

  setStatus('Starting Redis…');
  await redisService.start();

  twentyService = createTwentyService({
    configuration,
    appVersion: app.getVersion(),
  });

  const isFirstRun = !(await postgresService.hasCoreSchema());
  const previousState = loadNativeAppState(configuration.paths.stateFilePath);

  if (isFirstRun) {
    setStatus(
      'Setting up the database (first run, this can take a few minutes)…',
    );
    await twentyService.initialize('first-run');
    saveNativeAppState(configuration.paths.stateFilePath, {
      appVersion: app.getVersion(),
      initializedAt: new Date().toISOString(),
    });
  } else if (previousState?.appVersion !== app.getVersion()) {
    setStatus('Upgrading the database…');
    await twentyService.initialize('upgrade');
    saveNativeAppState(configuration.paths.stateFilePath, {
      appVersion: app.getVersion(),
      initializedAt: previousState?.initializedAt ?? new Date().toISOString(),
    });
  }

  setStatus('Starting Twenty…');
  twentyService.start();

  setStatus('Waiting for Twenty to answer…');
  await waitForSuccessfulRequest(
    `${configuration.serverUrl}/healthz`,
    HEALTH_CHECK_TIMEOUT_MS,
  );

  if (mainWindow) {
    await mainWindow.loadURL(configuration.serverUrl);
  }
};

const shutdown = async (): Promise<void> => {
  await twentyService?.stop();
  await redisService?.stop();
  await postgresService?.stop();
};

const showFatalError = async (error: unknown): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);

  console.error('[twenty-native] fatal:', message);

  // The dialog is modal; services must be down before it blocks the loop, or
  // a dismiss-later click leaves embedded postgres/redis running headless.
  if (!shutdownPromise) {
    shutdownPromise = shutdown().catch(() => undefined);
  }

  await shutdownPromise;
  dialog.showMessageBoxSync({
    type: 'error',
    title: 'Twenty failed to start',
    message,
    detail: `Logs: ${resolveUserDataPath()}/logs`,
  });
  app.exit(1);
};

const main = async (): Promise<void> => {
  // Keep one data directory across `electron .` and the packaged app.
  app.setPath('userData', resolveUserDataPath());
  Menu.setApplicationMenu(null);

  mainWindow = createWindow();

  try {
    await start();
  } catch (error) {
    await showFatalError(error);
  }
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.focus();
  });

  app.on('window-all-closed', () => {
    // Closing the window should stop the embedded services, not leave a
    // headless postgres/redis/server stack running.
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (shutdownPromise) {
      return;
    }

    event.preventDefault();
    shutdownPromise = shutdown().finally(() => {
      app.exit(0);
    });
  });

  void app.whenReady().then(main);
}
