/**
 * Test helper: imports the Express app and ensures the server is closed after tests.
 */

const { app, server } = require('../../src/app');

afterAll((done) => {
  if (server.listening) {
    server.close(done);
  } else {
    done();
  }
});

module.exports = { app, server };
