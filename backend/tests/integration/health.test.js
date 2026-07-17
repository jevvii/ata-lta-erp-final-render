/**
 * Health check integration test.
 */

const request = require('supertest');
const { app } = require('../helpers/testServer');

describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
