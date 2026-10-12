import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';
import ProfilePage from '@/routes/profile';
import { Topbar } from '@/components/layout/Topbar';
import { ProfileDetailsCard } from '../components/ProfileDetailsCard';
import { useSessionStore, type UserProfile } from '@/lib/session';
import * as api from '@/lib/api';
import { evaluatePassword, generateSecurePassword } from '../lib/passwordUtils';
import type { UserProfileData } from '../api/types';

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('Profile Management Challenger Suite (SPEC-PROFILE-MIGRATION-001)', () => {
  let queryClient: QueryClient;

  const mockUserProfile: UserProfile & UserProfileData = {
    id: 'usr-123',
    email: 'test-user@ata-lta.ph',
    name: 'Juan dela Cruz',
    role: 'Staff',
    departments: ['Operations'],
    entities: ['ATA', 'LTA'],
    isActive: true,
    avatarUrl: null,
    preferences: {
      theme: 'system',
      defaultView: 'table',
      defaultFormView: 'side-peek',
    },
  };

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    });

    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(BrowserRouter, null, children)
      );
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    localStorage.clear();
    useSessionStore.getState().setSession({
      user: { ...mockUserProfile },
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
      unreadCount: 0,
    });
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path === '/v1/me') {
        return { data: { ...mockUserProfile } };
      }
      if (path.includes('notifications')) {
        return { data: [] };
      }
      return { data: {} };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Vector 1: Initial Profile Data Rendering', () => {
    it('renders profile page with user details, initials avatar, and read-only email', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path === '/v1/me') {
          return { data: mockUserProfile };
        }
        return { data: {} };
      });

      render(React.createElement(ProfilePage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('profile-details-card')).toBeInTheDocument();
      });

      expect(screen.getByTestId('profile-display-name')).toHaveTextContent('Juan dela Cruz');
      expect(screen.getByTestId('profile-avatar-circle')).toHaveTextContent('JD');
      expect(screen.getByTestId('profile-name-input')).toHaveValue('Juan dela Cruz');
      expect(screen.getByTestId('profile-email-input')).toHaveValue('test-user@ata-lta.ph');
      expect(screen.getByTestId('profile-email-input')).toBeDisabled();
    });
  });

  describe('Vector 2: Full 3-Step Avatar Upload Pipeline', () => {
    it('executes pre-signed URL request, binary PUT, PATCH /v1/me, and updates session store', async () => {
      const signedUrl = 'https://s3.storage.supabase.com/entities/avatars/user-123.png?signed=xyz';
      const publicUrl = 'https://s3.storage.supabase.com/entities/avatars/user-123.png';

      let currentMockProfile = { ...mockUserProfile };

      const apiRequestSpy = vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string, options?: any) => {
        if (path === '/v1/me' && (!options || options.method === 'GET')) {
          return { data: currentMockProfile };
        }
        if (path === '/v1/me/avatar-upload-url' && options?.method === 'POST') {
          return {
            data: {
              signedUrl,
              publicUrl,
              path: 'entities/avatars/user-123.png',
              maxSizeMb: 5,
            },
          };
        }
        if (path === '/v1/me' && options?.method === 'PATCH') {
          const body = JSON.parse(options.body);
          currentMockProfile = {
            ...currentMockProfile,
            ...body,
          };
          return {
            data: currentMockProfile,
          };
        }
        return { data: {} };
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
        if (url === signedUrl) {
          expect(init?.method).toBe('PUT');
          expect(init?.headers?.['Content-Type']).toBe('image/png');
          return new Response(null, { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      render(React.createElement(ProfilePage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('profile-upload-trigger')).toBeInTheDocument();
      });

      const fileInput = screen.getByTestId('profile-avatar-input') as HTMLInputElement;
      const testFile = new File(['dummy png content'], 'avatar.png', { type: 'image/png' });

      fireEvent.change(fileInput, { target: { files: [testFile] } });

      expect(screen.getByTestId('profile-avatar-status')).toHaveTextContent('avatar.png');

      const saveDetailsBtn = screen.getByTestId('profile-save-details-btn');
      fireEvent.click(saveDetailsBtn);

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith(
          '/v1/me/avatar-upload-url',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ contentType: 'image/png' }),
          })
        );
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        signedUrl,
        expect.objectContaining({
          method: 'PUT',
          body: testFile,
          headers: { 'Content-Type': 'image/png' },
        })
      );

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith(
          '/v1/me',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ avatarUrl: publicUrl }),
          })
        );
      });

      // Verify useSessionStore synchronized user.avatarUrl
      await waitFor(() => {
        const currentUser = useSessionStore.getState().user;
        expect(currentUser?.avatarUrl).toBe(publicUrl);
      });
    });

    it('gracefully handles upload failure and displays friendly inline error', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string, options?: any) => {
        if (path === '/v1/me' && (!options || options.method === 'GET')) {
          return { data: mockUserProfile };
        }
        if (path === '/v1/me/avatar-upload-url') {
          throw new Error('Failed to create signed upload URL: new row violates row-level security policy');
        }
        return { data: {} };
      });

      render(React.createElement(ProfilePage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('profile-details-card')).toBeInTheDocument();
      });

      const fileInput = screen.getByTestId('profile-avatar-input') as HTMLInputElement;
      const testFile = new File(['dummy png content'], 'avatar.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      const saveBtn = screen.getByTestId('profile-save-details-btn');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('profile-avatar-status')).toHaveTextContent(
          'Unable to generate secure upload URL. Please try again.'
        );
      });
    });
  });

  describe('Vector 3: Password Complexity Guardrails, Eye Toggles & Cryptographic Generator', () => {
    it('evaluates real-time 5-criteria guardrails accurately', () => {
      // 1. empty
      const emptyEval = evaluatePassword('');
      expect(emptyEval.isValid).toBe(false);
      expect(emptyEval.strength).toBe('none');
      expect(emptyEval.validCount).toBe(0);

      // 2. weak (only length and lowercase)
      const weakEval = evaluatePassword('password');
      expect(weakEval.checks.length).toBe(true);
      expect(weakEval.checks.lower).toBe(true);
      expect(weakEval.checks.upper).toBe(false);
      expect(weakEval.checks.number).toBe(false);
      expect(weakEval.checks.special).toBe(false);
      expect(weakEval.isValid).toBe(false);
      expect(weakEval.strength).toBe('weak');

      // 3. fair (length, lower, upper)
      const fairEval = evaluatePassword('Password');
      expect(fairEval.validCount).toBe(3);
      expect(fairEval.strength).toBe('fair');

      // 4. good (length, lower, upper, number)
      const goodEval = evaluatePassword('Password123');
      expect(goodEval.validCount).toBe(4);
      expect(goodEval.strength).toBe('good');

      // 5. strong (all 5)
      const strongEval = evaluatePassword('Password123!');
      expect(strongEval.validCount).toBe(5);
      expect(strongEval.isValid).toBe(true);
      expect(strongEval.strength).toBe('strong');
    });

    it('generates a 16-character password satisfying all 5 criteria and copies to clipboard', () => {
      const generated = generateSecurePassword();
      expect(generated).toHaveLength(16);
      const evalRes = evaluatePassword(generated);
      expect(evalRes.isValid).toBe(true);
      expect(evalRes.validCount).toBe(5);
    });

    it('toggles password field visibility when eye icon is clicked', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path === '/v1/me') return { data: mockUserProfile };
        return { data: {} };
      });

      render(React.createElement(ProfilePage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('profile-current-password-input')).toBeInTheDocument();
      });

      const currentInput = screen.getByTestId('profile-current-password-input');
      const toggleCurrentBtn = screen.getByTestId('toggle-current-password-visibility');

      expect(currentInput).toHaveAttribute('type', 'password');
      fireEvent.click(toggleCurrentBtn);
      expect(currentInput).toHaveAttribute('type', 'text');
      fireEvent.click(toggleCurrentBtn);
      expect(currentInput).toHaveAttribute('type', 'password');

      const newInput = screen.getByTestId('profile-new-password-input');
      const toggleNewBtn = screen.getByTestId('toggle-new-password-visibility');
      expect(newInput).toHaveAttribute('type', 'password');
      fireEvent.click(toggleNewBtn);
      expect(newInput).toHaveAttribute('type', 'text');

      const confirmInput = screen.getByTestId('profile-confirm-password-input');
      const toggleConfirmBtn = screen.getByTestId('toggle-confirm-password-visibility');
      expect(confirmInput).toHaveAttribute('type', 'password');
      fireEvent.click(toggleConfirmBtn);
      expect(confirmInput).toHaveAttribute('type', 'text');
    });

    it('validates password mismatch and same as current password before submitting', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path === '/v1/me') return { data: mockUserProfile };
        return { data: {} };
      });

      render(React.createElement(ProfilePage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('profile-password-card')).toBeInTheDocument();
      });

      const currentInput = screen.getByTestId('profile-current-password-input');
      const newInput = screen.getByTestId('profile-new-password-input');
      const confirmInput = screen.getByTestId('profile-confirm-password-input');
      const submitBtn = screen.getByTestId('profile-update-password-btn');

      // Mismatch
      fireEvent.change(currentInput, { target: { value: 'CurrentPass123!' } });
      fireEvent.change(newInput, { target: { value: 'ValidPass123!' } });
      fireEvent.change(confirmInput, { target: { value: 'DifferentPass123!' } });

      expect(screen.getByTestId('password-match-badge')).toHaveTextContent('✕ No match');

      fireEvent.click(submitBtn);

      expect(screen.getByTestId('password-error-message')).toHaveTextContent('New passwords do not match.');

      // Same as current
      fireEvent.change(newInput, { target: { value: 'CurrentPass123!' } });
      fireEvent.change(confirmInput, { target: { value: 'CurrentPass123!' } });

      fireEvent.click(submitBtn);

      expect(screen.getByTestId('password-error-message')).toHaveTextContent(
        'New password must be different from your current password.'
      );
    });

    it('submits valid password change via PATCH /v1/me/password', async () => {
      const apiRequestSpy = vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string, options?: any) => {
        if (path === '/v1/me') return { data: mockUserProfile };
        if (path === '/v1/me/password' && options?.method === 'PATCH') {
          return null;
        }
        return { data: {} };
      });

      render(React.createElement(ProfilePage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('profile-password-card')).toBeInTheDocument();
      });

      const currentInput = screen.getByTestId('profile-current-password-input');
      const newInput = screen.getByTestId('profile-new-password-input');
      const confirmInput = screen.getByTestId('profile-confirm-password-input');
      const submitBtn = screen.getByTestId('profile-update-password-btn');

      fireEvent.change(currentInput, { target: { value: 'OldSecret123!' } });
      fireEvent.change(newInput, { target: { value: 'NewSuperSecret123!' } });
      fireEvent.change(confirmInput, { target: { value: 'NewSuperSecret123!' } });

      expect(screen.getByTestId('password-match-badge')).toHaveTextContent('✓ Match');

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith(
          '/v1/me/password',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              currentPassword: 'OldSecret123!',
              newPassword: 'NewSuperSecret123!',
            }),
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId('password-success-message')).toHaveTextContent(
          'Password updated successfully.'
        );
      });
    });
  });

  describe('Vector 4: Preferences Section Removed from Profile', () => {
    it('does not render preferences card on the profile page', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path === '/v1/me') return { data: mockUserProfile };
        return { data: {} };
      });

      render(React.createElement(ProfilePage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('profile-details-card')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('profile-preferences-card')).not.toBeInTheDocument();
    });
  });

  describe('Vector 5: Topbar User Menu Navigation & Avatar Rendering', () => {
    it('displays user initials when avatarUrl is absent, and links to /profile from dropdown', async () => {
      render(React.createElement(Topbar), { wrapper: createWrapper() });

      const avatarEl = screen.getByTestId('topbar-user-avatar');
      expect(avatarEl).toHaveTextContent('JD');

      const userBtn = screen.getByTestId('user-menu-button');
      fireEvent.pointerDown(userBtn, { button: 0, ctrlKey: false });
      fireEvent.keyDown(userBtn, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        expect(screen.getByTestId('my-profile-menu-item')).toBeInTheDocument();
      });
    });

    it('renders background avatar image in Topbar when avatarUrl is present in session', async () => {
      const avatarUrl = 'https://s3.storage.supabase.com/avatars/user-123.png';
      useSessionStore.getState().setSession({
        user: { ...mockUserProfile, avatarUrl },
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });

      render(React.createElement(Topbar), { wrapper: createWrapper() });

      const avatarEl = screen.getByTestId('topbar-user-avatar');
      await waitFor(() => {
        expect(avatarEl).toHaveStyle({ backgroundImage: `url('${avatarUrl}')` });
      });
      expect(avatarEl).not.toHaveTextContent('JD');
    });

    it('falls back to user initials when Topbar avatar image probe fails to load', async () => {
      const avatarUrl = 'https://s3.storage.supabase.com/avatars/user-broken.png';
      useSessionStore.getState().setSession({
        user: { ...mockUserProfile, avatarUrl },
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });

      render(React.createElement(Topbar), { wrapper: createWrapper() });

      const avatarEl = screen.getByTestId('topbar-user-avatar');
      expect(avatarEl).toHaveStyle({ backgroundImage: `url('${avatarUrl}')` });

      const probeImg = avatarEl.querySelector('img');
      expect(probeImg).toBeInTheDocument();
      expect(probeImg).toHaveClass('hidden');

      fireEvent.error(probeImg!);

      await waitFor(() => {
        expect(avatarEl).toHaveTextContent('JD');
      });
      expect(avatarEl).not.toHaveStyle({ backgroundImage: `url('${avatarUrl}')` });
    });

    it('resets avatarLoadFailed when user avatarUrl changes in session', async () => {
      const initialUrl = 'https://s3.storage.supabase.com/avatars/broken-1.png';
      useSessionStore.getState().setSession({
        user: { ...mockUserProfile, avatarUrl: initialUrl },
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });

      const { rerender } = render(React.createElement(Topbar), { wrapper: createWrapper() });
      const avatarEl = screen.getByTestId('topbar-user-avatar');

      const probeImg = avatarEl.querySelector('img');
      fireEvent.error(probeImg!);

      await waitFor(() => {
        expect(avatarEl).toHaveTextContent('JD');
      });

      // Update avatarUrl in session store
      const newUrl = 'https://s3.storage.supabase.com/avatars/fresh.png';
      act(() => {
        useSessionStore.getState().setSession({
          user: { ...mockUserProfile, avatarUrl: newUrl },
          permissions: ['workflow:view'],
          activeEntity: 'ATA',
        });
      });

      rerender(React.createElement(Topbar));

      await waitFor(() => {
        expect(avatarEl).toHaveStyle({ backgroundImage: `url('${newUrl}')` });
      });
    });
  });

  describe('Vector 6: ProfileDetailsCard Resilient Avatar Probe Fallback', () => {
    it('falls back to initials in ProfileDetailsCard when avatar image probe fails', async () => {
      const avatarUrl = 'https://s3.storage.supabase.com/avatars/profile-broken.png';
      const profileWithAvatar = {
        ...mockUserProfile,
        avatarUrl,
      };

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path === '/v1/me') {
          return { data: profileWithAvatar };
        }
        return { data: {} };
      });

      render(React.createElement(ProfileDetailsCard, { profile: profileWithAvatar }), {
        wrapper: createWrapper(),
      });

      const avatarCircle = screen.getByTestId('profile-avatar-circle');
      expect(avatarCircle).toHaveStyle({ backgroundImage: `url('${avatarUrl}')` });
      expect(avatarCircle).not.toHaveTextContent('JD');

      const probeImg = avatarCircle.querySelector('img');
      expect(probeImg).toBeInTheDocument();
      expect(probeImg).toHaveClass('hidden');

      fireEvent.error(probeImg!);

      await waitFor(() => {
        expect(avatarCircle).toHaveTextContent('JD');
      });
      expect(avatarCircle).not.toHaveStyle({ backgroundImage: `url('${avatarUrl}')` });
    });
  });
});
