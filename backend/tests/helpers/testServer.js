/**
 * Test helper: imports the Express app and ensures the server is closed after tests.
 */

process.env.SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'test-bucket';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';

const { app, server } = require('../../src/app');

afterAll((done) => {
  if (server.listening) {
    server.close(done);
  } else {
    done();
  }
});

module.exports = { app, server };
