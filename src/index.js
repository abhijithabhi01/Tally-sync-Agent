require('dotenv').config();

const logger = require('./logger');
const pushEngine = require('./pushEngine');
const writebackEngine = require('./writebackEngine');
const { healthCheck } = require('./tallyClient');
const startAdminServer = require('./adminServer');

let pushRunning = false;
let writebackRunning = false;
let shuttingDown = false;

// ─── Push cycle: Tally → Firestore ───────────────────────────────────────────
async function runPushCycle() {
  if (pushRunning || shuttingDown) return;
  pushRunning = true;

  try {
    const healthy = await healthCheck();
    if (!healthy) {
      logger.warn('Tally not reachable — skipping push cycle, will retry in 60s');
      return;
    }
    logger.info('Tally reachable — running push cycle');
    await pushEngine();
  } catch (err) {
    logger.error(`Push cycle crash: ${err.message}`);
  } finally {
    pushRunning = false;
  }
}

// ─── Writeback cycle: Firestore → Tally ──────────────────────────────────────
async function runWritebackCycle() {
  if (writebackRunning || shuttingDown) return;
  writebackRunning = true;

  try {
    const healthy = await healthCheck();
    if (!healthy) {
      logger.warn('Tally not reachable — Firestore queue synced locally, Tally write skipped');
      return; // ← add this
    }
    await writebackEngine();

  } catch (err) {
    logger.error(`Writeback crash: ${err.message}`);
  } finally {
    writebackRunning = false;
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
async function startupCheck() {
  logger.info('Tally Firestore Sync Agent Started');

  const tallyUp = await healthCheck();
  if (tallyUp) {
    logger.info('✓ Tally is reachable');
  } else {
    logger.warn('⚠ Tally is NOT reachable — agent will run in Firestore-only mode');
  }
}

// ─── Intervals ────────────────────────────────────────────────────────────────
const pushInterval = setInterval(runPushCycle, 60000);
const writebackInterval = setInterval(runWritebackCycle, 30000);

// ─── Boot ─────────────────────────────────────────────────────────────────────
startAdminServer(process.env.ADMIN_PORT || 3001);

startupCheck().then(() => {
  runPushCycle();
  runWritebackCycle();
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}`);
  shuttingDown = true;
  clearInterval(pushInterval);
  clearInterval(writebackInterval);

  const start = Date.now();
  while ((pushRunning || writebackRunning) && Date.now() - start < 10000) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', err => logger.error(`Uncaught Exception: ${err.message}`));
process.on('unhandledRejection', err => logger.error(`Unhandled Rejection: ${err}`));