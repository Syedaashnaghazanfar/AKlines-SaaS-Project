const express = require('express');
const controller = require('./auth.controller');
const { authenticate } = require('../../middleware/auth');

const router = express.Router();

// Public: create a brand-new tenant with its first Tenant Admin user.
router.post('/register-tenant', controller.registerTenant);
router.post('/login', controller.login);
router.get('/me', authenticate, controller.me);

module.exports = router;
