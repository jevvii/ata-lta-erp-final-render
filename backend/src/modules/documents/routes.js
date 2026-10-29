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

// --- Listing and Read Endpoints (allowAll: true) ---
router.get(
  '/counts',
  resolveEntity({ allowAll: true }),
  requirePermission('dms:view'),
  documentsController.getDocumentCounts
);
router.get(
  '/',
  resolveEntity({ allowAll: true }),
  requirePermission('dms:view'),
  documentsController.listDocuments
);
router.get(
  '/:id',
  resolveEntity({ allowAll: true }),
  requirePermission('dms:view'),
  documentsController.getDocument
);

// File previews have the same entity scope and read permission as document details.
router.get('/:id/download-url', resolveEntity({ allowAll: true }),
  requirePermission('dms:view'), documentsController.getDownloadUrl);

// Resolve entity code → UUID for all remaining mutation routes in this module
router.use(resolveEntity());

// Create document metadata + get upload URL
router.post(
  '/',
  requirePermission([
    'dms:edit',
    'workflow:task_upload',
    'disbursement:create',
    'disbursement:edit',
    'disbursement:request',
    'billing:create',
    'billing:edit',
    'billing:request',
  ]),
  audit('document.create', { table: 'documents' }),
  documentsController.createDocument
);

// The service authorizes task assignment or standalone DMS edit access.
router.post('/:id/comments',
  audit('document.comment.add', { table: 'documents' }), documentsController.addDocumentComment);
router.put('/:id/comments/:commentId',
  audit('document.comment.edit', { table: 'documents' }), documentsController.updateDocumentComment);
router.delete('/:id/comments/:commentId',
  audit('document.comment.delete', { table: 'documents' }), documentsController.deleteDocumentComment);

// Update document metadata
router.put(
  '/:id',
  requirePermission('dms:edit'),
  audit('document.update', { table: 'documents' }),
  documentsController.updateDocument
);

// Archive document
router.post(
  '/:id/archive',
  requirePermission('dms:edit'),
  audit('document.archive', { table: 'documents' }),
  documentsController.archiveDocument
);

// Unarchive document
router.post(
  '/:id/unarchive',
  requirePermission('dms:edit'),
  audit('document.unarchive', { table: 'documents' }),
  documentsController.unarchiveDocument
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
  requirePermission([
    'dms:edit',
    'workflow:task_upload',
    'disbursement:create',
    'disbursement:edit',
    'disbursement:request',
    'billing:create',
    'billing:edit',
    'billing:request',
  ]),
  audit('document.confirm-upload', { table: 'documents' }),
  documentsController.confirmUpload
);


// Transition lifecycle state
router.put(
  '/:id/lifecycle',
  requirePermission('dms:handover'),
  audit('document.lifecycle', { table: 'documents' }),
  documentsController.updateLifecycle
);

module.exports = router;
