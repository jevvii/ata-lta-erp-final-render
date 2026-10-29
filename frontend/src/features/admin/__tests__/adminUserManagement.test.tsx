import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserListTable } from '../components/UserListTable';
import { UserCreateModal } from '../components/UserCreateModal';
import { UserEditModal } from '../components/UserEditModal';
import { UserDisableModal } from '../components/UserDisableModal';
import { UserDetailModal } from '../components/UserDetailModal';
import { GuardedPasswordInput } from '../components/GuardedPasswordInput';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { AdminUser } from '../api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const mockUsers: AdminUser[] = [
  {
    id: 'user-admin',
    name: 'Admin Developer',
    email: 'dev-admin@ata-lta.ph',
    role: 'Admin',
    userNumber: 'USR-01',
    departments: ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'],
    entities: ['ATA', 'LTA'],
    isActive: true,
    version: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'user-docs',
    name: 'Doc Specialist',
    email: 'dev-docs@ata-lta.ph',
    role: 'Documentation',
    userNumber: 'USR-02',
    departments: ['Documentation', 'Management'],
    entities: ['ATA', 'LTA'],
    isActive: true,
    version: 3,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'user-disabled',
    name: 'Old Staff',
    email: 'old-staff@ata-lta.ph',
    role: 'Accounting',
    userNumber: 'USR-08',
    departments: ['Accounting'],
    entities: ['ATA'],
    isActive: false,
    version: 4,
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  },
];

describe('Admin User Management Components (Parity, Re-enable, OCC & Brutalist-Minimalist Profile)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'dev-admin@ata-lta.ph',
        name: 'Admin Developer',
        role: 'Admin',
        departments: ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['users:view', 'users:manage', 'retainers:use', 'retainers:edit'],
      activeEntity: 'ALL',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/admin/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockUsers }),
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

  describe('UserListTable', () => {
    it('renders user list with names, departments, entities, status pills, Eye profile button, and omits the Role column', async () => {
      const onViewDetailsMock = vi.fn();
      const { wrapper } = createHarness();
      render(
        <UserListTable
          onAddUser={vi.fn()}
          onEditUser={vi.fn()}
          onDisableUser={vi.fn()}
          onViewDetails={onViewDetailsMock}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('user-row-user-admin')).toBeInTheDocument();
        expect(screen.getByTestId('user-row-user-docs')).toBeInTheDocument();
        expect(screen.getByTestId('user-row-user-disabled')).toBeInTheDocument();
      });

      expect(screen.getByText('Admin Developer')).toBeInTheDocument();
      expect(screen.getByText('Doc Specialist')).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /^role$/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId('user-role-user-admin')).not.toBeInTheDocument();
      expect(screen.getByTestId('user-status-user-admin')).toHaveTextContent('Active');
      expect(screen.getByTestId('user-status-user-disabled')).toHaveTextContent('Disabled');

      // Eye profile button replaces KeyRound permissions button
      const detailBtn = screen.getByTestId('user-detail-btn-user-admin');
      expect(detailBtn).toHaveAttribute('title', 'View User Profile');
      fireEvent.click(detailBtn);
      expect(onViewDetailsMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-admin' })
      );
    });

    it('renders Re-enable User button for disabled accounts and sends PUT with expectedVersion', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method?.toUpperCase() || 'GET';
        if (method === 'PUT' && String(url).includes('/admin/users/user-disabled')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                ...mockUsers[2]!,
                isActive: true,
                status: 'Active',
                version: 5,
              },
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockUsers }),
        } as Response);
      });
      global.fetch = fetchMock;

      const { wrapper } = createHarness();
      render(<UserListTable />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('user-enable-btn-user-disabled')).toBeInTheDocument();
      });

      const enableBtn = screen.getByTestId('user-enable-btn-user-disabled');
      expect(enableBtn).toHaveAttribute('title', 'Re-enable user account');
      fireEvent.click(enableBtn);

      await waitFor(() => {
        const putCall = fetchMock.mock.calls.find(
          ([u, init]) =>
            String(u).includes('/admin/users/user-disabled') &&
            (init as RequestInit | undefined)?.method === 'PUT'
        );
        expect(putCall).toBeDefined();
        const body = JSON.parse(String((putCall?.[1] as RequestInit).body));
        expect(body).toMatchObject({
          status: 'Active',
          isActive: true,
          expectedVersion: 4,
        });
      });
    });

    it('filters users by search query (name and email)', async () => {
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
        expect(screen.getByTestId('user-row-user-admin')).toBeInTheDocument();
      });

      const searchInput = screen.getByTestId('user-search-input');
      fireEvent.change(searchInput, { target: { value: 'Specialist' } });

      expect(screen.queryByTestId('user-row-user-admin')).not.toBeInTheDocument();
      expect(screen.getByTestId('user-row-user-docs')).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'dev-admin@ata-lta.ph' } });
      expect(screen.getByTestId('user-row-user-admin')).toBeInTheDocument();
      expect(screen.queryByTestId('user-row-user-docs')).not.toBeInTheDocument();
    });

    it('enforces self-disable protection on active admin row', async () => {
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
        expect(screen.getByTestId('user-row-user-admin')).toBeInTheDocument();
      });

      const selfDisableBtn = screen.getByTestId('user-disable-btn-user-admin');
      expect(selfDisableBtn).toBeDisabled();
      expect(selfDisableBtn).toHaveAttribute('title', 'Cannot disable your own account');

      const otherDisableBtn = screen.getByTestId('user-disable-btn-user-docs');
      expect(otherDisableBtn).not.toBeDisabled();
    });

    it('displays active user cap banner when active accounts reach 15', async () => {
      const fifteenUsers: AdminUser[] = Array.from({ length: 15 }, (_, i) => ({
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
        json: async () => ({ data: fifteenUsers }),
      } as Response);

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
        expect(screen.getByTestId('user-cap-banner')).toBeInTheDocument();
      });

      expect(screen.getByTestId('user-cap-banner')).toHaveTextContent('User Account Cap Alert');
      expect(screen.getByTestId('user-cap-banner')).toHaveTextContent('15 active user accounts');
    });

    it('triggers callback when clicking + Add User', async () => {
      const onAddUserMock = vi.fn();
      const { wrapper } = createHarness();
      render(
        <UserListTable
          onAddUser={onAddUserMock}
          onEditUser={vi.fn()}
          onDisableUser={vi.fn()}
          onViewDetails={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('add-user-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('add-user-button'));
      expect(onAddUserMock).toHaveBeenCalledTimes(1);
    });

    it('Regression: Filtering Users displays each user persistent userNumber and NEVER resets to USR-01', async () => {
      const { wrapper } = createHarness();
      render(<UserListTable />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('user-row-user-admin')).toBeInTheDocument();
        expect(screen.getByTestId('user-row-user-disabled')).toBeInTheDocument();
      });

      // Initially all 3 rendered: user-disabled is 3rd row, should have USR-08 (not USR-03)
      expect(screen.getByTestId('user-id-user-admin')).toHaveTextContent('USR-01');
      expect(screen.getByTestId('user-id-user-docs')).toHaveTextContent('USR-02');
      expect(screen.getByTestId('user-id-user-disabled')).toHaveTextContent('USR-08');

      // Filter by searching 'Old Staff'
      const searchInput = screen.getByTestId('user-search-input');
      fireEvent.change(searchInput, { target: { value: 'Old Staff' } });

      // Only user-disabled is rendered. Its ID must remain USR-08 and NOT reset to USR-01!
      expect(screen.getByTestId('user-row-user-disabled')).toBeInTheDocument();
      expect(screen.queryByTestId('user-row-user-admin')).not.toBeInTheDocument();
      expect(screen.getByTestId('user-id-user-disabled')).toHaveTextContent('USR-08');

      // Also searching by 'USR-08' directly matches user-disabled
      fireEvent.change(searchInput, { target: { value: 'USR-08' } });
      expect(screen.getByTestId('user-row-user-disabled')).toBeInTheDocument();
      expect(screen.getByTestId('user-id-user-disabled')).toHaveTextContent('USR-08');
    });
  });

  describe('GuardedPasswordInput', () => {
    it('evaluates criteria checklist in real time as password changes', () => {
      const onChangeMock = vi.fn();
      const { rerender } = render(
        <GuardedPasswordInput value="" onChange={onChangeMock} />
      );

      expect(screen.getByTestId('guarded-password-criterion-length')).toHaveAttribute(
        'data-status',
        'unmet'
      );
      expect(screen.getByTestId('guarded-password-strength-label')).toHaveTextContent('None');

      rerender(<GuardedPasswordInput value="weak" onChange={onChangeMock} />);
      expect(screen.getByTestId('guarded-password-strength-label')).toHaveTextContent('Weak');
      expect(screen.getByTestId('guarded-password-criterion-lower')).toHaveAttribute(
        'data-status',
        'met'
      );

      rerender(<GuardedPasswordInput value="StrongP@ssw0rd!" onChange={onChangeMock} />);
      expect(screen.getByTestId('guarded-password-strength-label')).toHaveTextContent('Strong');
      expect(screen.getByTestId('guarded-password-criterion-length')).toHaveAttribute(
        'data-status',
        'met'
      );
      expect(screen.getByTestId('guarded-password-criterion-upper')).toHaveAttribute(
        'data-status',
        'met'
      );
      expect(screen.getByTestId('guarded-password-criterion-number')).toHaveAttribute(
        'data-status',
        'met'
      );
      expect(screen.getByTestId('guarded-password-criterion-special')).toHaveAttribute(
        'data-status',
        'met'
      );
    });

    it('generates random password and invokes onChange when clicking Generate button', async () => {
      const onChangeMock = vi.fn();
      render(<GuardedPasswordInput value="" onChange={onChangeMock} />);

      const generateBtn = screen.getByTestId('guarded-password-generate');
      fireEvent.click(generateBtn);

      expect(onChangeMock).toHaveBeenCalledTimes(1);
      const generated = onChangeMock.mock.calls[0]![0] as string;
      expect(generated.length).toBe(16);
    });

    it('toggles password visibility between text and password types', () => {
      render(<GuardedPasswordInput value="SecretPass123!" onChange={vi.fn()} />);

      const input = screen.getByTestId('guarded-password-input');
      const toggle = screen.getByTestId('guarded-password-toggle');

      expect(input).toHaveAttribute('type', 'password');
      fireEvent.click(toggle);
      expect(input).toHaveAttribute('type', 'text');
      fireEvent.click(toggle);
      expect(input).toHaveAttribute('type', 'password');
    });
  });

  describe('UserCreateModal', () => {
    it('submits valid new user data and closes on success', async () => {
      const onCloseMock = vi.fn();
      const onSuccessMock = vi.fn();
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: 'new-u-1',
            name: 'Carlos Yulo',
            email: 'carlos@ata-lta.ph',
            role: 'Operations',
            departments: ['Operations'],
            entities: ['ATA'],
            isActive: true,
            version: 1,
          },
        }),
      } as Response);

      render(
        <UserCreateModal
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('create-user-name-input'), {
        target: { value: 'Carlos Yulo' },
      });
      fireEvent.change(screen.getByTestId('create-user-email-input'), {
        target: { value: 'carlos@ata-lta.ph' },
      });
      fireEvent.change(screen.getByTestId('guarded-password-input'), {
        target: { value: 'GoldMedal2024!' },
      });

      fireEvent.click(screen.getByTestId('create-user-submit-btn'));

      await waitFor(() => {
        expect(onSuccessMock).toHaveBeenCalledTimes(1);
        expect(onCloseMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('UserEditModal (with OCC 409 Conflict Resolution)', () => {
    it('pre-populates user data and protects admin from self-deactivation', async () => {
      const { wrapper } = createHarness();
      render(
        <UserEditModal
          user={mockUsers[0]!}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('edit-user-name-input')).toHaveValue('Admin Developer');
      expect(screen.getByTestId('edit-user-email-input')).toHaveValue('dev-admin@ata-lta.ph');

      const activeCheckbox = screen.getByTestId('edit-user-active-checkbox');
      expect(activeCheckbox).toBeDisabled();
      expect(screen.getByText(/Cannot deactivate self/)).toBeInTheDocument();
    });

    it('opens ConflictResolutionModal when backend returns 409 CONCURRENCY_CONFLICT', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          status: 409,
          title: 'Conflict',
          code: 'CONCURRENCY_CONFLICT',
          detail: 'User record was modified by another administrator.',
        }),
      } as Response);

      const { wrapper } = createHarness();
      render(
        <UserEditModal
          user={mockUsers[1]!}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('edit-user-name-input'), {
        target: { value: 'Doc Specialist Updated' },
      });
      fireEvent.click(screen.getByTestId('edit-user-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      expect(useBlockingModalStore.getState().status).toBe('idle');
    });
  });

  describe('UserDisableModal', () => {
    it('blocks self-disable action with clear warning', () => {
      const { wrapper } = createHarness();
      render(
        <UserDisableModal
          user={mockUsers[0]!}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText(/Self-Action Blocked/)).toBeInTheDocument();
      expect(screen.queryByTestId('disable-user-confirm-btn')).not.toBeInTheDocument();
    });

    it('enables confirm button for other users and invokes disable with expectedVersion on click', async () => {
      const onCloseMock = vi.fn();
      const onSuccessMock = vi.fn();
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      } as Response);

      render(
        <UserDisableModal
          user={mockUsers[1]!}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('disable-user-confirm-btn')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('disable-user-confirm-btn'));

      await waitFor(() => {
        expect(onSuccessMock).toHaveBeenCalledTimes(1);
        expect(onCloseMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('UserDetailModal (Brutalist-Minimalist User Profile & Access Summary)', () => {
    it('renders User Identity Header, Role Summary, Authorized Entities, Assigned Departments, and Account Metadata without permissions matrix', () => {
      render(
        <UserDetailModal
          user={mockUsers[0]!}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByTestId('user-detail-modal')).toBeInTheDocument();
      expect(screen.getByTestId('user-detail-name')).toHaveTextContent('Admin Developer');
      expect(screen.getByTestId('user-detail-email')).toHaveTextContent('dev-admin@ata-lta.ph');
      expect(screen.getByTestId('user-detail-version')).toHaveTextContent('v2');
      expect(screen.getByTestId('user-detail-status')).toHaveTextContent('Active');
      expect(screen.getByTestId('user-detail-role')).toHaveTextContent('Admin');
      expect(screen.getByTestId('user-detail-entities')).toHaveTextContent('ATA');
      expect(screen.getByTestId('user-detail-entities')).toHaveTextContent('LTA');
      expect(screen.getByTestId('user-detail-departments')).toHaveTextContent('Management');
      expect(screen.getByTestId('user-detail-id')).toHaveTextContent('user-admin');

      // Legacy Effective Permissions Inspector must NOT be rendered
      expect(screen.queryByText('Effective Permissions Inspector')).not.toBeInTheDocument();
    });

    it('renders persistent userNumber badge in identity header when present', () => {
      render(
        <UserDetailModal
          user={mockUsers[2]!}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByTestId('user-detail-code')).toHaveTextContent('USR-08');
    });
  });
});
