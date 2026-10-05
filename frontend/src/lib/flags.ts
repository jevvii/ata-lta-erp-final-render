/**
 * Feature Flags for Enterprise Migration (Spec R5).
 * Module implementations land in Phase 2.
 * Unfinished modules remain disabled and render clean placeholders.
 */

export const ENABLED_MODULES = [
  'Operations',
  'Dashboard',
  'Billing',
  'Disbursements',
  'Transmittals',
  'Admin',
  'Reports',
  'Documents',
  'Clients',
] as const;

export type EnabledModule = (typeof ENABLED_MODULES)[number];

export function isModuleEnabled(moduleName: string): boolean {
  return (ENABLED_MODULES as readonly string[]).includes(moduleName);
}
