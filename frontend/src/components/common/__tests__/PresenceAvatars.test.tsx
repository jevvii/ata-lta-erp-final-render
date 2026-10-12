import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { PresenceAvatars, extractViewers, getInitials, getAvatarColorClass } from '../PresenceAvatars';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { queryClient } from '@/lib/api';

const currentUser: UserProfile = {
  id: 'user-curr-1',
  email: 'current@ata-lta.ph',
  name: 'Current Staff',
  role: 'Operations',
  departments: ['Operations'],
  entities: ['ATA'],
};

const otherUserA = {
  userId: 'user-other-a',
  email: 'lorein@ata-lta.ph',
  name: 'Lorein Wong',
  role: 'Accounting',
  avatarUrl: null,
};

const otherUserB = {
  userId: 'user-other-b',
  email: 'jane@ata-lta.ph',
  name: 'Jane Manager',
  role: 'Manager',
  avatarUrl: 'https://example.com/avatar-jane.png',
};

describe('PresenceAvatars Component (Parcel F - Ephemeral Collaboration)', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      user: currentUser,
      isAuthenticated: true,
      isLoading: false,
    });
  });

  afterEach(async () => {
    cleanup();
    localStorage.clear();
    queryClient.clear();
    await supabase.removeAllChannels();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Feature Flag & Guardrails
  // =========================================================================
  describe('Feature Flag & Empty Input Guards', () => {
    it('renders null and does not connect to Supabase channel when realtime_sync is false', () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { container } = render(<PresenceAvatars roomId="wr-101" />);

      expect(container.firstChild).toBeNull();
      expect(channelSpy).not.toHaveBeenCalled();
    });

    it('renders null and does not connect when roomId is empty string', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { container } = render(<PresenceAvatars roomId="" />);

      expect(container.firstChild).toBeNull();
      expect(channelSpy).not.toHaveBeenCalled();
    });

    it('renders null and does not connect when roomId is whitespace only', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { container } = render(<PresenceAvatars roomId="   " />);

      expect(container.firstChild).toBeNull();
      expect(channelSpy).not.toHaveBeenCalled();
    });

    it('renders null and does not connect when user session is null', () => {
      useSessionStore.setState({ user: null });
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { container } = render(<PresenceAvatars roomId="wr-101" />);

      expect(container.firstChild).toBeNull();
      expect(channelSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Presence Tracking Lifecycle (Join, Sync, Leave)
  // =========================================================================
  describe('Presence Tracking Lifecycle', () => {
    it('connects to Supabase channel presence:work_request:${roomId} and tracks current user on mount', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      render(<PresenceAvatars roomId="wr-101" />);

      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-101');
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      await waitFor(() => {
        const state = channel.presenceState();
        expect(state[currentUser.id]).toBeDefined();
        expect(state[currentUser.id]?.[0]).toMatchObject({
          userId: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role,
        });
      });
    });

    it('renders null when only the current user is present in the channel', async () => {
      const { container } = render(<PresenceAvatars roomId="wr-101" />);

      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      await waitFor(() => {
        expect(channel.presenceState()[currentUser.id]).toBeDefined();
      });

      // Since only currentUser is viewing, otherViewers is empty, should render null
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('presence-avatars')).toBeNull();
    });

    it('renders active viewer badge when another user joins via join/sync', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      // Simulate other user joining
      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
      });

      const avatar = screen.getByTestId(`presence-avatar-${otherUserA.userId}`);
      expect(avatar).toBeInTheDocument();
      expect(avatar).toHaveAttribute('title', 'Viewing now: Lorein Wong (Accounting)');
    });

    it('removes viewer avatar when that user leaves the presence channel', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      // Other user joins
      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
      });

      // Other user leaves
      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
        });
        channel.emit('presence', {
          event: 'leave',
          key: otherUserA.userId,
          leftPresences: [otherUserA],
        });
      });

      await waitFor(() => {
        expect(screen.queryByTestId(`presence-avatar-${otherUserA.userId}`)).toBeNull();
        expect(screen.queryByTestId('presence-avatars')).toBeNull();
      });
    });

    it('deduplicates viewers if the same user has multiple active browser tabs/presences', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [
            { ...otherUserA, presence_ref: 'ref-tab-1' },
            { ...otherUserA, presence_ref: 'ref-tab-2' },
          ],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
      });

      const avatars = screen.getAllByTestId(`presence-avatar-${otherUserA.userId}`);
      expect(avatars).toHaveLength(1);
    });

    it('keeps viewer avatar visible when one tab of a multi-tab user leaves but another tab remains active', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      // User A has 2 active tabs
      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [
            { ...otherUserA, presence_ref: 'ref-tab-1' },
            { ...otherUserA, presence_ref: 'ref-tab-2' },
          ],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
      });

      // Tab 1 leaves, but Tab 2 remains in currentPresences
      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [{ ...otherUserA, presence_ref: 'ref-tab-2' }],
        });
        channel.emit('presence', {
          event: 'leave',
          key: otherUserA.userId,
          leftPresences: [{ ...otherUserA, presence_ref: 'ref-tab-1' }],
          currentPresences: [{ ...otherUserA, presence_ref: 'ref-tab-2' }],
        });
      });

      // User A must STILL be visible because tab 2 is active!
      expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
    });

    it('removes viewer avatar on complete leave when leftPresences is emitted without pre-mutating channel state', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
      });

      // Emitting leave without manually pre-mutating channel.setPresenceState
      act(() => {
        channel.emit('presence', {
          event: 'leave',
          key: otherUserA.userId,
          leftPresences: [otherUserA],
          currentPresences: [],
        });
      });

      await waitFor(() => {
        expect(screen.queryByTestId(`presence-avatar-${otherUserA.userId}`)).toBeNull();
      });
    });

    it('clears viewers on transport failure (CHANNEL_ERROR, TIMED_OUT, CLOSED) and re-tracks upon reconnection', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
      });

      // Simulate channel network failure (e.g. TIMED_OUT)
      act(() => {
        channel.emitStatus('TIMED_OUT');
      });

      await waitFor(() => {
        expect(screen.queryByTestId('presence-avatars')).toBeNull();
      });

      // Simulate network reconnection (SUBSCRIBED)
      act(() => {
        channel.emitStatus('SUBSCRIBED');
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 3. UI, Avatar Stack & Tooltips
  // =========================================================================
  describe('UI, Avatar Stack & Tooltip Interactions', () => {
    it('renders initials badge when avatarUrl is missing', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByText('LW')).toBeInTheDocument();
      });
    });

    it('renders img element when avatarUrl is provided', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserB.userId]: [otherUserB],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        const img = screen.getByRole('img', { name: 'Jane Manager' });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/avatar-jane.png');
      });
    });

    it('displays Notion-style tooltip "Viewing now: [User Name] ([Role])" on hover', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
      });

      const avatar = screen.getByTestId(`presence-avatar-${otherUserA.userId}`);

      // Before hover, visible tooltip popup is not rendered
      expect(screen.queryByRole('tooltip')).toBeNull();

      // Hover over avatar
      fireEvent.mouseEnter(avatar);

      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveTextContent('Viewing now: Lorein Wong (Accounting)');

      // Mouse leave hides tooltip
      fireEvent.mouseLeave(avatar);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('displays tooltip on keyboard focus and dismisses on blur', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserB.userId]: [otherUserB],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserB.userId}`)).toBeInTheDocument();
      });

      const avatar = screen.getByTestId(`presence-avatar-${otherUserB.userId}`);

      fireEvent.focus(avatar);
      expect(screen.getByRole('tooltip')).toHaveTextContent('Viewing now: Jane Manager (Manager)');

      fireEvent.blur(avatar);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('shows overflow badge when viewers exceed maxAvatars and reveals names on hover', async () => {
      render(<PresenceAvatars roomId="wr-101" maxAvatars={1} />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserA.userId]: [otherUserA],
          [otherUserB.userId]: [otherUserB],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars-overflow')).toBeInTheDocument();
      });

      const overflowBadge = screen.getByTestId('presence-avatars-overflow');
      expect(overflowBadge).toHaveTextContent('+1');
      expect(overflowBadge).toHaveAttribute('title', expect.stringContaining('Jane Manager (Manager)'));

      // Hover over overflow badge
      fireEvent.mouseEnter(overflowBadge);
      const overflowTooltip = screen.getByTestId('presence-tooltip-overflow');
      expect(overflowTooltip).toBeInTheDocument();
      expect(overflowTooltip).toHaveTextContent('+1 more: Jane Manager (Manager)');

      fireEvent.mouseLeave(overflowBadge);
      expect(screen.queryByTestId('presence-tooltip-overflow')).toBeNull();
    });

    it('summarizes overflow viewers when more than 5 users exceed maxAvatars', async () => {
      const extraViewers = Array.from({ length: 8 }, (_, i) => ({
        userId: `user-extra-${i}`,
        email: `extra${i}@ata-lta.ph`,
        name: `Extra User ${i + 1}`,
        role: 'Operations',
      }));

      render(<PresenceAvatars roomId="wr-101" maxAvatars={1} />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        const state: Record<string, unknown[]> = {
          [currentUser.id]: [{ ...currentUser, userId: currentUser.id }],
          [otherUserA.userId]: [otherUserA],
        };
        for (const ev of extraViewers) {
          state[ev.userId] = [ev];
        }
        channel.setPresenceState(state);
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars-overflow')).toBeInTheDocument();
      });

      const overflowBadge = screen.getByTestId('presence-avatars-overflow');
      expect(overflowBadge).toHaveTextContent('+8');

      fireEvent.mouseEnter(overflowBadge);
      const tooltip = screen.getByTestId('presence-tooltip-overflow');
      expect(tooltip).toHaveTextContent('+8 more:');
      expect(tooltip).toHaveTextContent('and 3 others');
    });
  });

  // =========================================================================
  // 4. Teardown & Unmount Lifecycle
  // =========================================================================
  describe('Clean Untrack & Channel Teardown', () => {
    it('calls channel.untrack and supabase.removeChannel cleanly on component unmount', async () => {
      const { unmount } = render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      const untrackSpy = vi.spyOn(channel, 'untrack');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      unmount();

      expect(untrackSpy).toHaveBeenCalled();
      expect(removeChannelSpy).toHaveBeenCalledWith(channel);
    });

    it('handles rapid synchronous unmount without throwing or leaking ghost presences', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { unmount } = render(<PresenceAvatars roomId="wr-101" />);

      // Synchronous unmount before microtask runs
      expect(() => unmount()).not.toThrow();
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-101');
    });

    it('switches channels cleanly when roomId changes', async () => {
      const { rerender } = render(<PresenceAvatars roomId="wr-101" />);
      const channel1 = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;
      const removeSpy = vi.spyOn(supabase, 'removeChannel');

      await act(async () => {
        rerender(<PresenceAvatars roomId="wr-202" />);
      });

      expect(removeSpy).toHaveBeenCalledWith(channel1);
      const channel2 = supabase.channel('presence:work_request:wr-202') as unknown as MockRealtimeChannel;
      expect(channel2).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Unit Helpers (extractViewers, getInitials, getAvatarColorClass)
  // =========================================================================
  describe('Unit Helper Functions', () => {
    it('extractViewers ignores current user and handles fallback fields', () => {
      const state = {
        'curr-user': [{ userId: 'curr-user', name: 'Me', email: 'me@test.com', role: 'Staff' }],
        'anon-user': [{ id: 'anon-user', displayName: 'Anonymous Colleague' }],
      };

      const viewers = extractViewers(state, 'curr-user', 'me@test.com');
      expect(viewers).toHaveLength(1);
      expect(viewers[0]).toMatchObject({
        userId: 'anon-user',
        name: 'Anonymous Colleague',
        role: 'Staff',
      });
    });

    it('extractViewers sanitizes empty string avatarUrl to null', () => {
      const state = {
        'user-blank-avatar': [
          {
            userId: 'user-blank-avatar',
            name: 'Blank Avatar',
            avatarUrl: '   ',
          },
        ],
      };

      const viewers = extractViewers(state, 'curr-user');
      expect(viewers[0]?.avatarUrl).toBeNull();
    });

    it('getInitials parses single-word, multi-word, and empty names safely', () => {
      expect(getInitials('Lorein Wong')).toBe('LW');
      expect(getInitials('Alice')).toBe('AL');
      expect(getInitials('   ')).toBe('?');
      expect(getInitials('John Middle Doe')).toBe('JD');
    });

    it('getAvatarColorClass returns deterministic Tailwind class string', () => {
      const color1 = getAvatarColorClass('user-1');
      const color2 = getAvatarColorClass('user-1');
      expect(color1).toBe(color2);
      expect(typeof color1).toBe('string');
      expect(color1).toContain('text-white');
    });
  });

  // =========================================================================
  // 6. Adversarial Edge Cases & Stacking Robustness
  // =========================================================================
  describe('Adversarial Edge Cases & Stacking Robustness', () => {
    it('elevates avatar wrapper to z-30 on hover to prevent subsequent sibling badges from overlapping', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserA.userId]: [otherUserA],
          [otherUserB.userId]: [otherUserB],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
      });

      const avatarA = screen.getByTestId(`presence-avatar-${otherUserA.userId}`);
      expect(avatarA).toHaveClass('z-0');

      fireEvent.mouseEnter(avatarA);
      expect(avatarA).toHaveClass('z-30');

      fireEvent.mouseLeave(avatarA);
      expect(avatarA).toHaveClass('z-0');
    });

    it('falls back to initials when avatar image fails to load via onError', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserB.userId]: [otherUserB],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByRole('img', { name: 'Jane Manager' })).toBeInTheDocument();
      });

      const img = screen.getByRole('img', { name: 'Jane Manager' });
      fireEvent.error(img);

      // After image fails, fallback initials "JM" are displayed
      await waitFor(() => {
        expect(screen.queryByRole('img', { name: 'Jane Manager' })).toBeNull();
        expect(screen.getByText('JM')).toBeInTheDocument();
      });
    });

    it('does not falsely drop a viewer with an empty email when another colleague leaves', async () => {
      const colleagueWithoutEmail = {
        userId: 'user-no-email',
        name: 'No Email User',
        email: '',
        role: 'Field Worker',
      };

      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [colleagueWithoutEmail.userId]: [colleagueWithoutEmail],
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${colleagueWithoutEmail.userId}`)).toBeInTheDocument();
      });

      // otherUserA leaves with whitespace key payload
      act(() => {
        channel.emit('presence', {
          event: 'leave',
          key: '   ',
          leftPresences: [otherUserA],
          currentPresences: [],
        });
      });

      // colleagueWithoutEmail MUST still be present
      expect(screen.getByTestId(`presence-avatar-${colleagueWithoutEmail.userId}`)).toBeInTheDocument();
      // otherUserA must be removed
      expect(screen.queryByTestId(`presence-avatar-${otherUserA.userId}`)).toBeNull();
    });

    it('incorporates newPresences from join payload even if raw channel presenceState is lagging', async () => {
      render(<PresenceAvatars roomId="wr-101" />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      // Channel presence state contains only current user
      await waitFor(() => {
        expect(channel.presenceState()[currentUser.id]).toBeDefined();
      });

      // Incoming join event carries newPresences directly in the payload
      act(() => {
        channel.emit('presence', {
          event: 'join',
          key: otherUserA.userId,
          newPresences: [otherUserA],
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
      });
    });

    it('handles maxAvatars=0 gracefully by routing all viewers to overflow badge', async () => {
      render(<PresenceAvatars roomId="wr-101" maxAvatars={0} />);
      const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserA.userId]: [otherUserA],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars-overflow')).toBeInTheDocument();
      });

      expect(screen.queryByTestId(`presence-avatar-${otherUserA.userId}`)).toBeNull();
      const overflowBadge = screen.getByTestId('presence-avatars-overflow');
      expect(overflowBadge).toHaveTextContent('+1');
    });
  });

  // =========================================================================
  // 7. Universal Domain Routing & Cross-Domain Ephemeral Collaboration (Parcel 2A)
  // =========================================================================
  describe('Universal Domain Routing & Cross-Domain Ephemeral Collaboration (Parcel 2A)', () => {
    it('defaults to work_request domain when domain is omitted', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars roomId="wr-101" />);
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-101');
    });

    it('derives presence:invoice:${roomId} when domain="invoice"', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars domain="invoice" roomId="inv-202" />);
      expect(channelSpy).toHaveBeenCalledWith('presence:invoice:inv-202');
    });

    it('derives presence:disbursement:${roomId} when domain="disbursement"', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars domain="disbursement" roomId="disb-303" />);
      expect(channelSpy).toHaveBeenCalledWith('presence:disbursement:disb-303');
    });

    it('derives presence:document:${roomId} when domain="document"', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars domain="document" roomId="doc-404" />);
      expect(channelSpy).toHaveBeenCalledWith('presence:document:doc-404');
    });

    it('preserves cleanRoomId directly without double-prefixing when roomId already starts with presence:', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars domain="invoice" roomId="presence:custom:room-505" />);
      expect(channelSpy).toHaveBeenCalledWith('presence:custom:room-505');
    });

    it('trims whitespace on roomId and domain safely', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars domain="  document  " roomId="   doc-606   " />);
      expect(channelSpy).toHaveBeenCalledWith('presence:document:doc-606');
    });

    it('switches channels cleanly and untracks prior channel when domain prop changes', async () => {
      const { rerender } = render(<PresenceAvatars domain="invoice" roomId="item-707" />);
      const channelInv = supabase.channel('presence:invoice:item-707') as unknown as MockRealtimeChannel;
      const removeSpy = vi.spyOn(supabase, 'removeChannel');

      await act(async () => {
        rerender(<PresenceAvatars domain="disbursement" roomId="item-707" />);
      });

      expect(removeSpy).toHaveBeenCalledWith(channelInv);
      const channelDisb = supabase.channel('presence:disbursement:item-707') as unknown as MockRealtimeChannel;
      expect(channelDisb).toBeDefined();
    });

    it('resets otherViewers eagerly when domain or roomId changes before new sync arrives', async () => {
      const { rerender } = render(<PresenceAvatars domain="invoice" roomId="inv-808" />);
      const channel1 = supabase.channel('presence:invoice:inv-808') as unknown as MockRealtimeChannel;

      act(() => {
        channel1.setPresenceState({
          [otherUserA.userId]: [otherUserA],
        });
        channel1.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId(`presence-avatar-${otherUserA.userId}`)).toBeInTheDocument();
      });

      // Switch to new invoice room
      await act(async () => {
        rerender(<PresenceAvatars domain="invoice" roomId="inv-909" />);
      });

      // Old viewer must be cleared immediately (renders null since 0 viewers in new room)
      expect(screen.queryByTestId(`presence-avatar-${otherUserA.userId}`)).toBeNull();
    });

    it('strictly returns null and opens 0 channels across any domain when realtime_sync is false', () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { container } = render(<PresenceAvatars domain="document" roomId="doc-999" />);

      expect(container.firstChild).toBeNull();
      expect(channelSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. Cross-Module Cache Integration & Avatar Resolution
  // =========================================================================
  describe('Cross-Module Cache Integration & Avatar Resolution', () => {
    it('resolves viewer avatar from cached team registry (["me", "team"]) when presence payload has null avatarUrl', async () => {
      queryClient.setQueryData(['me', 'team'], [
        {
          id: otherUserA.userId,
          name: otherUserA.name,
          email: otherUserA.email,
          role: otherUserA.role,
          avatarUrl: 'https://example.com/resolved-lorein-avatar.png',
        },
      ]);

      render(<PresenceAvatars roomId="wr-resolved-team" />);
      const channel = supabase.channel('presence:work_request:wr-resolved-team') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [otherUserA.userId]: [otherUserA], // otherUserA.avatarUrl is null
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        const img = screen.getByRole('img', { name: 'Lorein Wong' });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/resolved-lorein-avatar.png');
      });
    });

    it('extractViewers correctly resolves snake_case avatar_url as well as camelCase avatarUrl', () => {
      const state = {
        'user-camel': [{ userId: 'user-camel', name: 'Camel Case', avatarUrl: 'https://example.com/camel.png' }],
        'user-snake': [{ userId: 'user-snake', name: 'Snake Case', avatar_url: 'https://example.com/snake.png' }],
        'user-both': [
          {
            userId: 'user-both',
            name: 'Both Cases',
            avatarUrl: 'https://example.com/camel-priority.png',
            avatar_url: 'https://example.com/snake.png',
          },
        ],
        'user-snake-blank': [{ userId: 'user-snake-blank', name: 'Blank Snake', avatar_url: '   ' }],
      };

      const viewers = extractViewers(state, 'curr-user');
      const camelViewer = viewers.find((v) => v.userId === 'user-camel');
      const snakeViewer = viewers.find((v) => v.userId === 'user-snake');
      const bothViewer = viewers.find((v) => v.userId === 'user-both');
      const blankViewer = viewers.find((v) => v.userId === 'user-snake-blank');

      expect(camelViewer?.avatarUrl).toBe('https://example.com/camel.png');
      expect(snakeViewer?.avatarUrl).toBe('https://example.com/snake.png');
      expect(bothViewer?.avatarUrl).toBe('https://example.com/camel-priority.png');
      expect(blankViewer?.avatarUrl).toBeNull();
    });

    it('renders avatar img for other viewer broadcasting snake_case avatar_url in presence state', async () => {
      const userWithSnakeAvatar = {
        userId: 'user-snake-presence',
        email: 'snake@ata-lta.ph',
        name: 'Snake Presence',
        role: 'Field Worker',
        avatar_url: 'https://example.com/snake-presence.png',
      };

      render(<PresenceAvatars roomId="wr-snake-case" />);
      const channel = supabase.channel('presence:work_request:wr-snake-case') as unknown as MockRealtimeChannel;

      act(() => {
        channel.setPresenceState({
          [userWithSnakeAvatar.userId]: [userWithSnakeAvatar],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        const img = screen.getByRole('img', { name: 'Snake Presence' });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/snake-presence.png');
      });
    });
  });
});
