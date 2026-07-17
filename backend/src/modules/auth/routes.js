/**
 * Public authentication routes.
 */

const express = require('express');
const router = express.Router();
const { authController } = require('./controller');

router.post('/signin', authController.signIn);

module.exports = router;
