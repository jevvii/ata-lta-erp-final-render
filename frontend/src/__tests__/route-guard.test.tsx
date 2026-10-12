import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RouteGuard } from '@/components/auth/RouteGuard';
import { useSessionStore } from '@/lib/session';

describe('RouteGuard component (Spec §3.2, §6)', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it('renders loading placeholder while session is initializing', () => {
    useSessionStore.setState({ isLoading: true });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <RouteGuard>
                <div data-testid="protected-content">Secret Data</div>
              </RouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', () => {
    useSessionStore.setState({ isAuthenticated: false, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <RouteGuard>
                <div data-testid="protected-content">Secret Data</div>
              </RouteGuard>
            }
          />
          <Route path="/login" element={<div data-testid="login-page-stub">Login Screen</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('login-page-stub')).toBeInTheDocument();
  });

  it('renders children when authenticated and no specific permission is required', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-1',
        email: 'staff@ata-lta.ph',
        name: 'Staff Member',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view'],
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <RouteGuard>
                <div data-testid="dashboard-content">Dashboard View</div>
              </RouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();
    expect(screen.getByText('Dashboard View')).toBeInTheDocument();
  });

  it('renders children when authenticated and user possesses required permission', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-1',
        email: 'billing@ata-lta.ph',
        name: 'Billing Staff',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view'],
    });

    render(
      <MemoryRouter initialEntries={['/billing']}>
        <Routes>
          <Route
            path="/billing"
            element={
              <RouteGuard requiredPermission="billing:view">
                <div data-testid="billing-content">Invoices and Payments</div>
              </RouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('billing-content')).toBeInTheDocument();
  });

  it('renders <Forbidden/> screen (never silent blank) when required permission is missing', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-1',
        email: 'docs@ata-lta.ph',
        name: 'Documentation Staff',
        role: 'Documentation',
        departments: ['Documentation'],
        entities: ['ATA'],
      },
      permissions: ['dms:view', 'transmittal:view'],
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RouteGuard requiredPermission="users:manage">
                <div data-testid="admin-content">Admin Settings</div>
              </RouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
    expect(screen.getByText('Access Forbidden')).toBeInTheDocument();
    expect(screen.getByText('users:manage')).toBeInTheDocument();
  });

  it('satisfies required permission via granted wildcard', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-1',
        email: 'manager@ata-lta.ph',
        name: 'Operations Manager',
        role: 'Manager',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['approve_change:*'],
    });

    render(
      <MemoryRouter initialEntries={['/approvals']}>
        <Routes>
          <Route
            path="/approvals"
            element={
              <RouteGuard requiredPermission="approve_change:disbursements">
                <div data-testid="approvals-content">Approved Disbursements</div>
              </RouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('approvals-content')).toBeInTheDocument();
  });

  it('blocks non-admin user when adminOnly is required even with reports:view', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-staff',
        email: 'staff@ata-lta.ph',
        name: 'Staff Member',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['reports:view', 'workflow:view'],
    });

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route
            path="/reports"
            element={
              <RouteGuard adminOnly requiredPermission="reports:view">
                <div data-testid="reports-content">Reports Data</div>
              </RouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('reports-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
  });

  it('allows admin user when adminOnly is required', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['reports:view', 'users:manage'],
    });

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route
            path="/reports"
            element={
              <RouteGuard adminOnly requiredPermission="reports:view">
                <div data-testid="reports-content">Reports Data</div>
              </RouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('reports-content')).toBeInTheDocument();
  });
});
