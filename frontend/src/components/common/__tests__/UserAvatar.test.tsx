import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  UserAvatar,
  getUserInitials,
  getAvatarColorStyle,
} from '../UserAvatar';
import { useSessionStore } from '@/lib/session';

describe('UserAvatar Component & Helpers', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    useSessionStore.setState({
      user: null,
      isAuthenticated: false,
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('getUserInitials helper', () => {
    it('extracts two-letter initials from standard full names', () => {
      expect(getUserInitials('Jane Doe')).toBe('JD');
      expect(getUserInitials('Maria Santos')).toBe('MS');
      expect(getUserInitials('John William Smith')).toBe('JS');
    });

    it('extracts two letters from single names', () => {
      expect(getUserInitials('Jane')).toBe('JA');
      expect(getUserInitials('Admin')).toBe('AD');
      expect(getUserInitials('A')).toBe('A');
    });

    it('extracts initials cleanly from email addresses', () => {
      expect(getUserInitials('jane.doe@example.com')).toBe('JD');
      expect(getUserInitials('lorein@ata-lta.ph')).toBe('LO');
    });

    it('handles null, undefined, empty, and question marks gracefully', () => {
      expect(getUserInitials(null)).toBe('?');
      expect(getUserInitials(undefined)).toBe('?');
      expect(getUserInitials('')).toBe('?');
      expect(getUserInitials('   ')).toBe('?');
      expect(getUserInitials('?')).toBe('?');
    });
  });

  describe('getAvatarColorStyle helper', () => {
    it('returns a deterministic color with white text', () => {
      const color1 = getAvatarColorStyle('user-123');
      const color2 = getAvatarColorStyle('user-123');
      expect(color1.bg).toBe(color2.bg);
      expect(color1.color).toBe('#FFFFFF');
      expect(color1.backgroundColor).toBe(color1.bg);
    });

    it('picks from the curated 8-color palette', () => {
      const allowedColors = [
        '#1D4ED8',
        '#047857',
        '#6D28D9',
        '#B45309',
        '#BE123C',
        '#0E7490',
        '#4338CA',
        '#334155',
      ];
      for (const key of ['user-1', 'admin@example.com', 'Maria', 'WR-001', 'xyz']) {
        const style = getAvatarColorStyle(key);
        expect(allowedColors).toContain(style.bg);
      }
    });
  });

  describe('Direct avatarUrl rendering', () => {
    it('renders img element when avatarUrl is provided', () => {
      render(
        <UserAvatar
          userId="user-1"
          name="Maria Santos"
          avatarUrl="https://example.com/maria.png"
          imgTestId="maria-img"
          data-testid="maria-avatar"
        />
      );

      const avatar = screen.getByTestId('maria-avatar');
      expect(avatar).toBeInTheDocument();
      const img = screen.getByTestId('maria-img');
      expect(img).toHaveAttribute('src', 'https://example.com/maria.png');
      expect(img).toHaveAttribute('alt', 'Maria Santos');
    });

    it('falls back to initials when avatarUrl fails to load via onError', () => {
      render(
        <UserAvatar
          userId="user-1"
          name="Maria Santos"
          avatarUrl="https://example.com/broken.png"
          imgTestId="broken-img"
          initialsTestId="fallback-initials"
          data-testid="maria-avatar"
        />
      );

      const img = screen.getByTestId('broken-img');
      fireEvent.error(img);

      expect(screen.queryByTestId('broken-img')).toBeNull();
      const initials = screen.getByTestId('fallback-initials');
      expect(initials).toHaveTextContent('MS');
    });

    it('resets imgError when avatarUrl prop changes', () => {
      const { rerender } = render(
        <UserAvatar
          userId="user-1"
          name="Maria Santos"
          avatarUrl="https://example.com/broken.png"
          imgTestId="broken-img"
          initialsTestId="fallback-initials"
        />
      );

      fireEvent.error(screen.getByTestId('broken-img'));
      expect(screen.getByTestId('fallback-initials')).toBeInTheDocument();

      rerender(
        <UserAvatar
          userId="user-1"
          name="Maria Santos"
          avatarUrl="https://example.com/fixed.png"
          imgTestId="fixed-img"
          initialsTestId="fallback-initials"
        />
      );

      expect(screen.getByTestId('fixed-img')).toBeInTheDocument();
      expect(screen.queryByTestId('fallback-initials')).toBeNull();
    });
  });

  describe('Session Store & QueryClient Cache Resolution', () => {
    it('resolves avatarUrl from session user when matching userId', () => {
      useSessionStore.setState({
        user: {
          id: 'user-curr-1',
          name: 'Current User',
          email: 'current@example.com',
          role: 'Staff',
          departments: [],
          entities: ['ATA'],
          avatarUrl: 'https://example.com/current-user.png',
        },
      });

      render(
        <UserAvatar
          userId="user-curr-1"
          name="Current User"
          imgTestId="session-img"
        />
      );

      const img = screen.getByTestId('session-img');
      expect(img).toHaveAttribute('src', 'https://example.com/current-user.png');
    });

    it('resolves avatarUrl from QueryClient ["me", "team"] query cache', () => {
      queryClient.setQueryData(['me', 'team'], [
        {
          id: 'team-user-1',
          name: 'Team Colleague',
          email: 'colleague@example.com',
          avatarUrl: 'https://example.com/team-colleague.png',
        },
      ]);

      render(
        <QueryClientProvider client={queryClient}>
          <UserAvatar
            userId="team-user-1"
            name="Team Colleague"
            imgTestId="team-img"
          />
        </QueryClientProvider>
      );

      const img = screen.getByTestId('team-img');
      expect(img).toHaveAttribute('src', 'https://example.com/team-colleague.png');
    });

    it('resolves avatarUrl from QueryClient ["admin", "users"] query cache with { data: [...] } structure', () => {
      queryClient.setQueryData(['admin', 'users'], {
        data: [
          {
            id: 'admin-user-99',
            name: 'Lorein Wong',
            email: 'lorein@example.com',
            avatarUrl: 'https://example.com/admin-lorein.png',
          },
        ],
      });

      render(
        <QueryClientProvider client={queryClient}>
          <UserAvatar
            userId="admin-user-99"
            name="Lorein Wong"
            imgTestId="admin-img"
          />
        </QueryClientProvider>
      );

      const img = screen.getByTestId('admin-img');
      expect(img).toHaveAttribute('src', 'https://example.com/admin-lorein.png');
    });

    it('renders outside QueryClientProvider gracefully without crashing', () => {
      render(
        <UserAvatar
          userId="no-provider-user"
          name="No Provider"
          initialsTestId="no-provider-initials"
        />
      );

      expect(screen.getByTestId('no-provider-initials')).toHaveTextContent('NP');
    });
  });

  describe('Sizes, Shapes, Ring & Card-Color Independence', () => {
    it('applies sizes and shapes accurately', () => {
      const { rerender } = render(
        <UserAvatar
          userId="user-1"
          name="Test User"
          size="xs"
          shape="circle"
          data-testid="styled-avatar"
        />
      );

      let el = screen.getByTestId('styled-avatar');
      expect(el.className).toContain('rounded-full');
      expect(el.className).toContain('h-5');
      expect(el.className).toContain('w-5');

      rerender(
        <UserAvatar
          userId="user-1"
          name="Test User"
          size="lg"
          shape="rounded"
          ring
          data-testid="styled-avatar"
        />
      );

      el = screen.getByTestId('styled-avatar');
      expect(el.className).toContain('rounded-[6px]');
      expect(el.className).toContain('h-10');
      expect(el.className).toContain('w-10');
      expect(el.className).toContain('ring-1');
    });

    it('ensures fallback color is deterministic and card-color independent', () => {
      render(
        <div style={{ backgroundColor: '#FF0000', color: '#00FF00' }}>
          <UserAvatar
            userId="card-isolation-user"
            name="Isolated User"
            data-testid="isolated-avatar"
          />
        </div>
      );

      const avatar = screen.getByTestId('isolated-avatar');
      expect(avatar.style.backgroundColor).toMatch(/rgb\(4,\s*120,\s*87\)|#047857/i);
      expect(avatar.style.color).toBe('rgb(255, 255, 255)');
    });
  });
});
