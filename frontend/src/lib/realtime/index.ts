/**
 * Realtime CDC Sync Module (Stage 3, Parcel E)
 *
 * Exports the generic useEntityRealtimeSync hook, safety guards, and testing utilities.
 */

export {
  useEntityRealtimeSync,
  handleRealtimePayload,
  clearChannelRegistryForTesting,
  normalizeCdcTask,
  normalizeCdcWorkRequest,
  normalizeCdcOperationsRequest,
  normalizeCdcNotification,
  normalizeCdcPayload,
  isSoftDeleteRecord,
  isTaskListOfTargetWr,
  triggerTaskCoInvalidations,
  triggerCrossDomainCoInvalidations,
  mergeCdcRecordPreservingEnrichedLinks,
  normalizeCdcTimeEntry,
  normalizeCdcTaskTimeLog,
  normalizeCdcUser,
  normalizeCdcAuditLog,
  normalizeCdcClient,
  normalizePersistentItemNumbers,
  triggerTimeEntryCoInvalidation,
} from './useEntityRealtimeSync';
export type {
  UseEntityRealtimeSyncOptions,
  RealtimeTable,
} from './useEntityRealtimeSync';
export {
  trackLocalMutation,
  registerLocalMutation,
  isLocalMutation,
  isSelfOriginatedPayload,
  clearLocalMutationsForTesting,
} from './loopPrevention';
export {
  resolveEntityUUID,
  resolveEntityCodeFromUUID,
  registerEntityMapping,
  resetEntityMappingsForTesting,
  ENTITY_MAP,
  UUID_TO_CODE_MAP,
} from './tenantResolver';

