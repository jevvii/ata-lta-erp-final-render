/**
 * Admin / Users module routes.
 * Phase 8 implementation by Agent A.
 */

const express = require('express');
const router = express.Router();
const { adminController } = require('./controller');
const { auth } = require('../../middleware/auth');
const { entityScope } = require('../../middleware/entityScope');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');

// Users
router.get('/users', auth, entityScope, requirePermission('users:view'), adminController.listUsers);
router.post('/users', auth, entityScope, requirePermission('users:manage'), audit('user.created', { table: 'users' }), adminController.createUser);
router.get('/users/:id', auth, entityScope, requirePermission('users:view'), adminController.getUserById);
router.put('/users/:id', auth, entityScope, requirePermission('users:manage'), audit('user.updated', { table: 'users' }), adminController.updateUser);
router.delete('/users/:id', auth, entityScope, requirePermission('users:manage'), audit('user.disabled', { table: 'users' }), adminController.deleteUser);

// Pending approvals
router.get('/pending-approvals', auth, entityScope, requirePermission('approve_change:*'), adminController.listPendingApprovals);
router.post('/pending-approvals/:id/approve', auth, entityScope, requirePermission('approve_change:*'), audit('pending.approved', { table: 'pending_changes' }), adminController.approvePending);
router.post('/pending-approvals/:id/reject', auth, entityScope, requirePermission('approve_change:*'), audit('pending.rejected', { table: 'pending_changes' }), adminController.rejectPending);

// Audit log count (for admin tab badge)
router.get('/audit/count', auth, entityScope, requirePermission('users:view'), adminController.getAuditLogCount);

module.exports = router;
