#!/usr/bin/env node
/**
 * Root operational entrypoint for receipt orphan cleanup.
 */
module.exports = require('../src/scripts/cleanupOrphanReceipts');
if (require.main === module) {
  module.exports.run()
    .then((summary) => process.exit(summary.errors.length ? 1 : 0))
    .catch(() => process.exit(1));
}
