/**
 * Public authentication routes.
 */

const express = require('express');
const router = express.Router();
const { authController } = require('./controller');

router.post('/signin', authController.signIn);
router.post('/refresh', authController.refresh);

module.exports = router;
