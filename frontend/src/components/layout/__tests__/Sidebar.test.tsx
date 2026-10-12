import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { useSessionStore } from '@/lib/session';

describe('Sidebar Component', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it('does not display MODULES or DEVELOPMENT header labels, nor Kitchen Sink', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['reports:view', 'users:manage', 'billing:view', 'workflow:view', 'clients:view'],
    });

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    // Verify MODULES and DEVELOPMENT headers are removed
    expect(screen.queryByText(/^MODULES$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^DEVELOPMENT$/i)).not.toBeInTheDocument();

    // Verify Kitchen Sink is removed
    expect(screen.queryByText(/Kitchen Sink/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-item-kitchen-sink')).not.toBeInTheDocument();
  });

  it('hides Reports from sidebar for non-admin users even with reports:view permission', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-staff',
        email: 'staff@ata-lta.ph',
        name: 'Staff Member',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['reports:view', 'workflow:view', 'clients:view'],
    });

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    // Operations and Clients are visible
    expect(screen.getByTestId('nav-item-operations')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-clients')).toBeInTheDocument();

    // Reports and Admin are hidden for non-admin
    expect(screen.queryByTestId('nav-item-reports')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-item-admin')).not.toBeInTheDocument();
  });

  it('displays Reports and Admin in sidebar for Admin users', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['reports:view', 'users:manage', 'workflow:view'],
    });

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    // Reports and Admin are both visible for Admin
    expect(screen.getByTestId('nav-item-reports')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-admin')).toBeInTheDocument();
  });
});
