#!/usr/bin/env node
/**
 * Operational cleanup script for expired receipt reservations and orphan storage objects.
 * Usage:
 *   node src/scripts/cleanupOrphanReceipts.js [--dry-run] [--ttl-ms 900000] [--retention-ms 86400000]
 */

const { cleanupExpiredReservations } = require('../modules/disbursements/receiptReservationStore');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    ttlMs: undefined,
    consumedRetentionMs: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--ttl-ms' && args[i + 1]) {
      options.ttlMs = parseInt(args[++i], 10);
    } else if (arg === '--retention-ms' && args[i + 1]) {
      options.consumedRetentionMs = parseInt(args[++i], 10);
    }
  }

  return options;
};

const run = async () => {
  const options = parseArgs();
  const startTime = Date.now();
  // eslint-disable-next-line no-console
  console.log(`Starting receipt reservation orphan cleanup (dryRun: ${options.dryRun})...`);

  try {
    const summary = await cleanupExpiredReservations(options);
    const durationMs = Date.now() - startTime;

    // eslint-disable-next-line no-console
    console.log(`Cleanup completed successfully in ${durationMs}ms:`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));

    if (summary.errors && summary.errors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`Warning: Encountered ${summary.errors.length} storage errors during cleanup (retained for retry).`);
    }

    return summary;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Fatal error during receipt orphan cleanup:', err);
    throw err;
  }
};

if (require.main === module) {
  run()
    .then((summary) => process.exit(summary.errors.length ? 1 : 0))
    .catch(() => process.exit(1));
}

module.exports = { run, parseArgs };
