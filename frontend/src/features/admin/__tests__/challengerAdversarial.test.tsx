import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { Suspense } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouteGuard } from '@/components/auth/RouteGuard';
import AdminPage from '@/routes/admin';
import { UserListTable } from '../components/UserListTable';
import { UserCreateModal } from '../components/UserCreateModal';
import { UserEditModal } from '../components/UserEditModal';
import { UserDisableModal } from '../components/UserDisableModal';
import { RetainerTemplateModal } from '@/features/operations/components/RetainerTemplateModal';
import { createUserAction, updateUserAction } from '../api/useUsers';
import {
  useBlockingModalStore,
  BlockingActionModal,
} from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { AdminUser } from '../api/types';

function createHarness(initialEntries = ['/admin']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const AppWithRouting = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RouteGuard requiredPermission="users:manage">
                <Suspense fallback={<div>Loading route...</div>}>
                  <AdminPage />
                </Suspense>
              </RouteGuard>
            }
          />
          <Route path="/dashboard" element={<div data-testid="dashboard-screen">Dashboard</div>} />
          <Route path="/login" element={<div data-testid="login-screen">Login</div>} />
        </Routes>
        <BlockingActionModal />
      </MemoryRouter>
    </QueryClientProvider>
  );

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        {children}
        <BlockingActionModal />
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { queryClient, AppWithRouting, wrapper };
}

const mockAdminUser: AdminUser = {
  id: 'user-admin-1',
  name: 'Primary Administrator',
  email: 'admin@ata-lta.ph',
  role: 'Admin',
  departments: ['Management', 'Operations', 'Accounting'],
  entities: ['ATA', 'LTA'],
  isActive: true,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockManagerUser: AdminUser = {
  id: 'user-docs-mgr',
  name: 'Documentation Manager',
  email: 'dev-docs@ata-lta.ph',
  role: 'Manager',
  departments: ['Documentation', 'Management'],
  entities: ['ATA', 'LTA'],
  isActive: true,
  version: 2,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const mockAccountingUser: AdminUser = {
  id: 'user-accs-staff',
  name: 'Accounting Staff',
  email: 'dev-accs@ata-lta.ph',
  role: 'Accounting',
  departments: ['Accounting'],
  entities: ['ATA'],
  isActive: true,
  version: 1,
  createdAt: '2026-01-03T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
};

describe('Empirical Challenger: Module #6 Adversarial RBAC, OCC & Security Test Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/admin/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [mockAdminUser, mockManagerUser, mockAccountingUser],
          }),
        } as Response);
      }
      if (u.includes('/admin/audit/count')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { total: 0 } }),
        } as Response);
      }
      if (u.includes('/admin/audit')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [],
            meta: { total: 0, limit: 20, offset: 0, hasMore: false },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    useBlockingModalStore.getState().reset();
  });

  // ==========================================================================
  // SCOPE ITEM 1: Route /admin Security Matrix & Non-Admin Denial
  // ==========================================================================
  describe('Scope 1: Route /admin Security Matrix & Non-Admin Denial', () => {
    it('adversarially blocks Accounting Staff (dev-accs@ata-lta.ph) with <Forbidden requiredPermission="users:manage" />', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockAccountingUser.id,
          email: mockAccountingUser.email,
          name: mockAccountingUser.name,
          role: 'Accounting',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit', 'disbursement:view'],
        activeEntity: 'ATA',
      });

      const { AppWithRouting } = createHarness(['/admin']);
      render(<AppWithRouting />);

      await waitFor(() => {
        expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
      });

      expect(screen.getByText('Access Forbidden')).toBeInTheDocument();
      expect(screen.getByText('users:manage')).toBeInTheDocument();
      expect(screen.queryByTestId('admin-page')).not.toBeInTheDocument();
      expect(screen.queryByTestId('admin-tabs-container')).not.toBeInTheDocument();
    });

    it('adversarially blocks Documentation Manager (dev-docs@ata-lta.ph) who has users:view but lacks users:manage', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockManagerUser.id,
          email: mockManagerUser.email,
          name: mockManagerUser.name,
          role: 'Manager',
          departments: ['Documentation', 'Management'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['users:view', 'retainers:use', 'workflow:view', 'workflow:edit'],
        activeEntity: 'ALL',
      });

      const { AppWithRouting } = createHarness(['/admin']);
      render(<AppWithRouting />);

      await waitFor(() => {
        expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
      });

      expect(screen.getByText('users:manage')).toBeInTheDocument();
      expect(screen.queryByTestId('admin-page')).not.toBeInTheDocument();
    });

    it('adversarially blocks Operations Specialist (dev-ops@ata-lta.ph) with zero admin permissions', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-ops',
          email: 'dev-ops@ata-lta.ph',
          name: 'Operations Specialist',
          role: 'Operations',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit', 'timelog:create'],
        activeEntity: 'ATA',
      });

      const { AppWithRouting } = createHarness(['/admin']);
      render(<AppWithRouting />);

      await waitFor(() => {
        expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
      });

      expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('admin-tabs-container')).not.toBeInTheDocument();
    });

    it('blocks unauthenticated user by redirecting to login', async () => {
      useSessionStore.getState().clearSession();

      const { AppWithRouting } = createHarness(['/admin']);
      render(<AppWithRouting />);

      await waitFor(() => {
        expect(screen.getByTestId('login-screen')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('admin-page')).not.toBeInTheDocument();
      expect(screen.queryByTestId('forbidden-screen')).not.toBeInTheDocument();
    });

    it('allows genuine Administrator (dev-admin@ata-lta.ph) with users:manage', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockAdminUser.id,
          email: mockAdminUser.email,
          name: mockAdminUser.name,
          role: 'Admin',
          departments: ['Management', 'Operations'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['users:view', 'users:manage', 'retainers:edit', 'retainers:use'],
        activeEntity: 'ALL',
      });

      const { AppWithRouting } = createHarness(['/admin']);
      render(<AppWithRouting />);

      await waitFor(() => {
        expect(screen.getByTestId('admin-page')).toBeInTheDocument();
        expect(screen.getByTestId('admin-tabs-container')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('forbidden-screen')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // SCOPE ITEM 2: Relocated RetainerTemplateModal RBAC & 409 Conflict Handling
  // ==========================================================================
  describe('Scope 2: Relocated RetainerTemplateModal RBAC & Conflict Handling', () => {
    it('proves RetainerTemplateModal renders Access Restricted when invoked by user lacking retainers:edit', () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockManagerUser.id,
          email: mockManagerUser.email,
          name: mockManagerUser.name,
          role: 'Manager',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['retainers:use'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('unauthorized-retainer-modal')).toBeInTheDocument();
      expect(screen.getByText('Access Restricted')).toBeInTheDocument();
      expect(screen.getByTestId('unauthorized-retainer-modal')).toHaveTextContent(
        'retainers:edit required'
      );
      expect(screen.queryByTestId('retainer-template-modal')).not.toBeInTheDocument();
    });

    it('surfaces HTTP 409 PERIOD_ALREADY_GENERATED conflict verbatim in RetainerTemplateModal', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockAdminUser.id,
          email: mockAdminUser.email,
          name: mockAdminUser.name,
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['retainers:edit', 'retainers:use', 'users:manage'],
        activeEntity: 'ATA',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          status: 409,
          title: 'Conflict',
          code: 'PERIOD_ALREADY_GENERATED',
          detail: 'Period already generated for this template',
        }),
      } as Response);

      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('template-name-input'), {
        target: { value: 'Duplicate Period Attempt' },
      });
      fireEvent.change(screen.getByTestId('task-title-input-0'), {
        target: { value: 'Task Row 1' },
      });

      fireEvent.click(screen.getByTestId('template-modal-submit-btn'));

      await waitFor(() => {
        const modalState = useBlockingModalStore.getState();
        expect(modalState.status).toBe('error');
        expect(modalState.error?.code).toBe('PERIOD_ALREADY_GENERATED');
        expect(modalState.error?.detail).toBe('Period already generated for this template');
      });

      expect(screen.getByTestId('error-code-badge')).toHaveTextContent('PERIOD_ALREADY_GENERATED');
      expect(screen.getByTestId('error-detail-body')).toHaveTextContent(
        'Period already generated for this template'
      );
    });
  });

  // ==========================================================================
  // SCOPE ITEM 3: Self-Account Protection (Admin Cannot Disable/Delete Themselves)
  // ==========================================================================
  describe('Scope 3: Self-Account Protection Invariants', () => {
    it('disables the Disable Account button in UserListTable for the currently logged-in administrator', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockAdminUser.id,
          email: mockAdminUser.email,
          name: mockAdminUser.name,
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['users:view', 'users:manage'],
        activeEntity: 'ALL',
      });

      const { wrapper } = createHarness();
      render(
        <UserListTable
          onAddUser={vi.fn()}
          onEditUser={vi.fn()}
          onDisableUser={vi.fn()}
          onViewDetails={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId(`user-row-${mockAdminUser.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`user-row-${mockManagerUser.id}`)).toBeInTheDocument();
      });

      const selfDisableBtn = screen.getByTestId(`user-disable-btn-${mockAdminUser.id}`);
      expect(selfDisableBtn).toBeDisabled();
      expect(selfDisableBtn).toHaveAttribute('title', 'Cannot disable your own account');

      const otherDisableBtn = screen.getByTestId(`user-disable-btn-${mockManagerUser.id}`);
      expect(otherDisableBtn).not.toBeDisabled();
    });

    it('strictly prevents confirmation in UserDisableModal when self-account is provided', () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockAdminUser.id,
          email: mockAdminUser.email,
          name: mockAdminUser.name,
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['users:view', 'users:manage'],
        activeEntity: 'ALL',
      });

      const { wrapper } = createHarness();
      render(
        <UserDisableModal
          user={mockAdminUser}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText(/Self-Action Blocked/)).toBeInTheDocument();
      expect(
        screen.getByText(/You cannot disable your own active administrator account/)
      ).toBeInTheDocument();

      expect(screen.queryByTestId('disable-user-confirm-btn')).not.toBeInTheDocument();
    });

    it('proves UserEditModal disables the active account checkbox for self-account and blocks self-deactivation', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: mockAdminUser.id,
          email: mockAdminUser.email,
          name: mockAdminUser.name,
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['users:view', 'users:manage'],
        activeEntity: 'ALL',
      });

      const { wrapper } = createHarness();
      render(
        <UserEditModal
          user={mockAdminUser}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText(/Self-Account Notice/)).toBeInTheDocument();

      const activeCheckbox = screen.getByTestId('edit-user-active-checkbox');
      expect(activeCheckbox).toBeDisabled();
      expect(screen.getByText(/Cannot deactivate self/)).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // SCOPE ITEM 4: Active User Cap of 15, Validation & OCC Conflict Handling
  // ==========================================================================
  describe('Scope 4: Active User Cap of 15 & Error Handling', () => {
    it('displays warning banner in UserListTable and UserCreateModal when active users reach 15', async () => {
      const fifteenActiveUsers: AdminUser[] = Array.from({ length: 15 }, (_, i) => ({
        id: `u-${i}`,
        name: `User ${i}`,
        email: `user${i}@ata-lta.ph`,
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }));

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: fifteenActiveUsers }),
      } as Response);

      const { wrapper } = createHarness();
      render(
        <div>
          <UserListTable
            onAddUser={vi.fn()}
            onEditUser={vi.fn()}
            onDisableUser={vi.fn()}
            onViewDetails={vi.fn()}
          />
          <UserCreateModal
            isOpen={true}
            onClose={vi.fn()}
            activeUsersCount={15}
          />
        </div>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('user-cap-banner')).toBeInTheDocument();
      });

      expect(screen.getByTestId('user-cap-banner')).toHaveTextContent('User Account Cap Alert');
      expect(screen.getByTestId('user-cap-banner')).toHaveTextContent(
        'System currently has 15 active user accounts'
      );

      expect(screen.getByText(/Active Account Cap Warning/)).toBeInTheDocument();
      expect(screen.getByText(/The system has reached 15 active users/)).toBeInTheDocument();
    });

    it('proves HTTP 403 USER_LIMIT_REACHED from backend is caught and surfaced verbatim in BlockingActionModal', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          title: 'Forbidden',
          code: 'USER_LIMIT_REACHED',
          detail:
            'Maximum number of user accounts (15) reached. Contact the administrator to disable an existing account before adding a new one.',
        }),
      } as Response);

      const { wrapper } = createHarness();
      render(
        <UserCreateModal
          isOpen={true}
          onClose={vi.fn()}
          activeUsersCount={15}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('create-user-name-input'), {
        target: { value: 'Cap Exceeded User' },
      });
      fireEvent.change(screen.getByTestId('create-user-email-input'), {
        target: { value: 'exceeded@ata-lta.ph' },
      });
      fireEvent.change(screen.getByTestId('guarded-password-input'), {
        target: { value: 'ValidPass123!' },
      });

      fireEvent.click(screen.getByTestId('create-user-submit-btn'));

      await waitFor(() => {
        const modalState = useBlockingModalStore.getState();
        expect(modalState.status).toBe('error');
        expect(modalState.error?.code).toBe('USER_LIMIT_REACHED');
        expect(modalState.error?.status).toBe(403);
        expect(modalState.error?.detail).toContain('Maximum number of user accounts (15) reached');
      });

      expect(screen.getByTestId('error-code-badge')).toHaveTextContent('USER_LIMIT_REACHED');
      expect(screen.getByTestId('error-detail-body')).toHaveTextContent(
        'Maximum number of user accounts (15) reached'
      );
    });

    it('proves HTTP 400 validation error (e.g. duplicate email) is caught and surfaced cleanly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          status: 400,
          title: 'Bad Request',
          code: 'VALIDATION_ERROR',
          detail: 'Email address already registered to an existing account',
        }),
      } as Response);

      await expect(
        createUserAction({
          name: 'Duplicate Test',
          email: 'admin@ata-lta.ph',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        })
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });

      expect(useBlockingModalStore.getState().status).toBe('error');
      expect(useBlockingModalStore.getState().error?.code).toBe('VALIDATION_ERROR');
      expect(useBlockingModalStore.getState().error?.detail).toBe(
        'Email address already registered to an existing account'
      );
    });

    it('resets BlockingActionModal on HTTP 409 CONCURRENCY_CONFLICT during updateUserAction so ConflictResolutionModal takes precedence', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          status: 409,
          title: 'Conflict',
          code: 'CONCURRENCY_CONFLICT',
          detail: 'User record version mismatch.',
        }),
      } as Response);

      await expect(
        updateUserAction('user-docs-mgr', {
          name: 'Concurrent Edit',
          expectedVersion: 1,
        })
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONCURRENCY_CONFLICT',
      });

      expect(useBlockingModalStore.getState().status).toBe('idle');
    });
  });
});
