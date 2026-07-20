/**
 * Documents module routes.
 * Mounted at /v1/documents by app.js.
 *
 * Phase 3 — Agent B
 */

const express = require('express');
const router = express.Router();
const { documentsController } = require('./controller');
const { requirePermission } = require('../../middleware/rbac');
const { audit } = require('../../middleware/audit');
const { resolveEntity } = require('../../middleware/resolveEntity');

// Resolve entity code → UUID for all routes in this module
router.use(resolveEntity());

// List documents
router.get('/', requirePermission('dms:view'), documentsController.listDocuments);

// Create document metadata + get upload URL
router.post(
  '/',
  requirePermission('dms:edit'),
  audit('document.create', { table: 'documents' }),
  documentsController.createDocument
);

// Get single document
router.get('/:id', requirePermission('dms:view'), documentsController.getDocument);

// Update document metadata
router.put(
  '/:id',
  requirePermission('dms:edit'),
  audit('document.update', { table: 'documents' }),
  documentsController.updateDocument
);

// Soft-delete document
router.delete(
  '/:id',
  requirePermission('dms:delete'),
  audit('document.delete', { table: 'documents' }),
  documentsController.deleteDocument
);

// Confirm storage upload completed
router.post(
  '/:id/confirm-upload',
  requirePermission('dms:edit'),
  audit('document.confirm-upload', { table: 'documents' }),
  documentsController.confirmUpload
);

// Get signed download URL
router.get('/:id/download-url', requirePermission('dms:view'), documentsController.getDownloadUrl);

// Transition lifecycle state
router.put(
  '/:id/lifecycle',
  requirePermission('dms:handover'),
  audit('document.lifecycle', { table: 'documents' }),
  documentsController.updateLifecycle
);

module.exports = router;
