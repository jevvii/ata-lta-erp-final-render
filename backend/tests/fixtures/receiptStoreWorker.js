// Separate Node process, sharing exactly the same store path as other workers.
const store = require('../../src/modules/disbursements/receiptReservationStore');
process.on('message', ({ action, input }) => {
  try {
    process.send({ result: store[action](input) });
  } catch (err) {
    process.send({ error: err.code || err.message });
  }
});
process.send({ ready: true });
