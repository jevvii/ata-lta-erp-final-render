/**
 * Current user routes.
 * Implemented by Agent A as part of Phase 1.
 */

const express = require('express');
const router = express.Router();
const { meController } = require('./controller');

router.get('/', meController.getMe);
router.get('/permissions', meController.getPermissions);

module.exports = router;
