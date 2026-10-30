import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import {
  PresenceAvatars,
  extractViewers,
  getInitials,
  getAvatarColorClass,
  type ViewerPresence,
} from '../PresenceAvatars';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore, type UserProfile } from '@/lib/session';

const mockCurrentUser: UserProfile = {
  id: 'usr-empirical-lead',
  email: 'lead@ata-lta.ph',
  name: 'Empirical Challenger',
  role: 'Quality Assurance',
  departments: ['QA', 'Operations'],
  entities: ['ATA', 'LTA'],
};

const sampleColleague1: ViewerPresence = {
  userId: 'usr-colleague-1',
  name: 'Colleague One',
  email: 'colleague1@ata-lta.ph',
  role: 'Operations Reviewer',
  avatarUrl: null,
};

const sampleColleague2: ViewerPresence = {
  userId: 'usr-colleague-2',
  name: 'Colleague Two',
  email: 'colleague2@ata-lta.ph',
  role: 'Auditor',
  avatarUrl: 'https://example.com/avatar2.jpg',
};

describe('Adversarial Stress Harness: Ephemeral Presence Avatars & Cross-Surface Protocol', () => {
  let fetchSpy: import('vitest').MockInstance<typeof fetch>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useSessionStore.setState({
      user: mockCurrentUser,
      isAuthenticated: true,
      isLoading: false,
    });
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
  });

  afterEach(async () => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    await supabase.removeAllChannels();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Vector 1: Extreme & Adversarial Room ID and Domain Inputs
  // =========================================================================
  describe('Vector 1: Extreme & Adversarial Room ID and Domain Inputs', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only spaces', '   '],
      ['tabs and newlines', '\t\n \r '],
    ])('renders null and subscribes to 0 channels on %s', (_desc, emptyRoomId) => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { container } = render(<PresenceAvatars roomId={emptyRoomId} />);

      expect(container.firstChild).toBeNull();
      expect(channelSpy).not.toHaveBeenCalled();
      expect(supabase.getChannels().length).toBe(0);
    });

    it('does not double-prefix when roomId is already prefixed with presence:domain:id', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars domain="invoice" roomId="presence:custom_domain:wr-999" />);

      expect(channelSpy).toHaveBeenCalledWith('presence:custom_domain:wr-999');
    });

    it('does not double-prefix when roomId starts with bare "presence:"', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(<PresenceAvatars domain="invoice" roomId="presence:already_clean_123" />);

      expect(channelSpy).toHaveBeenCalledWith('presence:already_clean_123');
    });

    it('handles special characters, slashes, URL queries, and unicode symbols in roomId and domain', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      render(
        <PresenceAvatars
          domain="  document/v2?filter=active  "
          roomId="  inv/2026/01#item&seq=42⚡🚀  "
        />
      );

      expect(channelSpy).toHaveBeenCalledWith(
        'presence:document/v2?filter=active:inv/2026/01#item&seq=42⚡🚀'
      );
    });

    it('falls back to "work_request" when domain is undefined, empty string, or whitespace', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { rerender } = render(<PresenceAvatars roomId="wr-test-1" domain="" />);
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-test-1');

      rerender(<PresenceAvatars roomId="wr-test-1" domain="   " />);
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-test-1');
    });

    it.each([
      ['negative number', -5],
      ['zero', 0],
      ['fractional float', 1.8],
      ['extreme upper bound', 99999],
    ])('handles extreme maxAvatars=%s without throwing or breaking overflow badge', async (_desc, maxAvatars) => {
      render(<PresenceAvatars roomId="wr-stress-1" maxAvatars={maxAvatars} />);
      const ch = supabase.channel('presence:work_request:wr-stress-1') as unknown as MockRealtimeChannel;

      act(() => {
        ch.setPresenceState({
          [sampleColleague1.userId]: [sampleColleague1],
          [sampleColleague2.userId]: [sampleColleague2],
        });
        ch.emit('presence', { event: 'sync' });
      });

      await act(async () => {});
      const root = screen.getByTestId('presence-avatars');
      expect(root).toBeInTheDocument();

      if (maxAvatars <= 0) {
        // All viewers routed to overflow badge
        expect(screen.getByTestId('presence-avatars-overflow')).toHaveTextContent('+2');
      } else {
        expect(screen.getByTestId(`presence-avatar-${sampleColleague1.userId}`)).toBeInTheDocument();
      }
    });
  });

  // =========================================================================
  // Vector 2: Rapid Prop Thrashing & Rapid Unmount (Race Stress)
  // =========================================================================
  describe('Vector 2: Rapid Prop Thrashing & Rapid Unmount', () => {
    it('rapidly switches roomId 25 times synchronously and cleans up every intermediate channel with zero leaks', async () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');
      const { rerender, unmount } = render(<PresenceAvatars roomId="wr-initial" />);

      for (let i = 1; i <= 25; i++) {
        act(() => {
          rerender(<PresenceAvatars roomId={`wr-rapid-${i}`} />);
        });
      }

      // 25 prior channels should have been removed
      expect(removeChannelSpy).toHaveBeenCalledTimes(25);

      // Only 1 channel should remain registered in supabase client
      expect(supabase.getChannels().length).toBe(1);
      expect(supabase.getChannels()[0]?.topic).toBe('realtime:presence:work_request:wr-rapid-25');

      // Unmount final instance
      unmount();
      expect(removeChannelSpy).toHaveBeenCalledTimes(26);
      expect(supabase.getChannels().length).toBe(0);
    });

    it('rapidly alternates domain and roomId 20 times between invoice and disbursement', async () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');
      const { rerender, unmount } = render(<PresenceAvatars domain="invoice" roomId="item-0" />);

      for (let i = 1; i <= 20; i++) {
        const domain = i % 2 === 0 ? 'invoice' : 'disbursement';
        act(() => {
          rerender(<PresenceAvatars domain={domain} roomId={`item-${i}`} />);
        });
      }

      expect(removeChannelSpy).toHaveBeenCalledTimes(20);
      expect(supabase.getChannels().length).toBe(1);
      expect(supabase.getChannels()[0]?.topic).toBe('realtime:presence:invoice:item-20');

      unmount();
      expect(removeChannelSpy).toHaveBeenCalledTimes(21);
      expect(supabase.getChannels().length).toBe(0);
    });

    it('handles instantaneous unmount before subscribe or track callbacks resolve', async () => {
      const untrackSpy = vi.fn();
      const channel = supabase.channel('presence:work_request:wr-instant-unmount') as unknown as MockRealtimeChannel;
      vi.spyOn(channel, 'untrack').mockImplementation(async () => {
        untrackSpy();
        return 'ok';
      });

      const { unmount } = render(<PresenceAvatars roomId="wr-instant-unmount" />);
      // Unmount immediately before any microtask
      unmount();

      // Trigger status callback after unmount to simulate delayed network handshake
      act(() => {
        channel.emitStatus('SUBSCRIBED');
      });

      // No ghost viewer tracking should occur on unmounted component
      expect(supabase.getChannels().length).toBe(0);
    });
  });

  // =========================================================================
  // Vector 3: Channel Subscription Leak & Memory Leak Audit
  // =========================================================================
  describe('Vector 3: Channel Subscription Leak & Memory Leak Audit', () => {
    it('repeatedly mounts and unmounts 50 component instances in a loop and returns active channel count to 0', async () => {
      for (let i = 0; i < 50; i++) {
        const { unmount } = render(<PresenceAvatars roomId={`wr-loop-${i}`} />);
        unmount();
      }

      // Zero leaked channels
      expect(supabase.getChannels().length).toBe(0);
    });

    it('calls channel.untrack() and supabase.removeChannel() on every unmount', async () => {
      const removeSpy = vi.spyOn(supabase, 'removeChannel');
      const { unmount } = render(<PresenceAvatars domain="document" roomId="doc-verify-untrack" />);

      const channel = supabase.channel('presence:document:doc-verify-untrack') as unknown as MockRealtimeChannel;
      const untrackSpy = vi.spyOn(channel, 'untrack');

      unmount();

      expect(untrackSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalledWith(channel);
      expect(supabase.getChannels().length).toBe(0);
    });
  });

  // =========================================================================
  // Vector 4: Realtime Sync Feature Flag Gating
  // =========================================================================
  describe('Vector 4: Realtime Sync Feature Flag Gating', () => {
    it('returns null and opens zero channels when realtime_sync is false', () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { container } = render(<PresenceAvatars domain="invoice" roomId="inv-flag-test" />);

      expect(container.firstChild).toBeNull();
      expect(channelSpy).not.toHaveBeenCalled();
      expect(supabase.getChannels().length).toBe(0);
    });

    it('tears down active channel immediately if realtime_sync is toggled from true to false', async () => {
      const removeSpy = vi.spyOn(supabase, 'removeChannel');
      const { rerender, container } = render(<PresenceAvatars roomId="wr-flag-toggle" />);

      expect(supabase.getChannels().length).toBe(1);

      // Disable flag and rerender
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      act(() => {
        rerender(<PresenceAvatars roomId="wr-flag-toggle" />);
      });

      expect(container.firstChild).toBeNull();
      expect(removeSpy).toHaveBeenCalled();
      expect(supabase.getChannels().length).toBe(0);
    });
  });

  // =========================================================================
  // Vector 5: Database Zero-Write Verification
  // =========================================================================
  describe('Vector 5: Database Zero-Write Verification', () => {
    it('verifies 0 persistent database or API mutation writes occur across all presence lifecycles', async () => {
      // Mount, join viewer, sync, leave, change room, unmount
      const { rerender, unmount } = render(<PresenceAvatars domain="disbursement" roomId="disb-db-audit" />);
      const ch1 = supabase.channel('presence:disbursement:disb-db-audit') as unknown as MockRealtimeChannel;

      act(() => {
        ch1.setPresenceState({
          [sampleColleague1.userId]: [sampleColleague1],
          [sampleColleague2.userId]: [sampleColleague2],
        });
        ch1.emit('presence', { event: 'sync' });
      });

      act(() => {
        ch1.emit('presence', {
          event: 'leave',
          key: sampleColleague1.userId,
          leftPresences: [sampleColleague1],
          currentPresences: [],
        });
      });

      act(() => {
        rerender(<PresenceAvatars domain="invoice" roomId="inv-db-audit" />);
      });

      unmount();

      // Inspect all network calls recorded by fetch
      for (const call of fetchSpy.mock.calls) {
        const url = String(call[0]);
        const opts = call[1] as RequestInit | undefined;
        const method = (opts?.method || 'GET').toUpperCase();

        expect(url).not.toContain('/presence');
        expect(['POST', 'PUT', 'PATCH', 'DELETE']).not.toContain(method);
      }

      // Ensure 0 DB writes occurred
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Vector 6: Adversarial Presence Payloads & Parsing Robustness
  // =========================================================================
  describe('Vector 6: Adversarial Presence Payloads & Parsing Robustness', () => {
    it('extractViewers survives corrupted, null, and malformed state structures and uses key fallback', () => {
      const corruptedState: Record<string, unknown> = {
        'corrupted-1': null,
        'corrupted-2': undefined,
        'corrupted-3': 12345,
        'corrupted-4': 'just a raw string',
        'corrupted-5': [null, undefined, 42, false],
        'corrupted-6': [{}], // empty record uses key as fallback userId
        'valid-1': [{
          userId: 'usr-valid-99',
          name: 'Valid User',
          email: 'valid@ata-lta.ph',
          role: 'Reviewer',
          avatarUrl: '   ', // whitespace avatarUrl should be cleaned to null
        }],
      };

      const viewers = extractViewers(corruptedState, mockCurrentUser.id, mockCurrentUser.email);
      // Non-objects (null, undefined, number, string, array of primitives) are safely skipped
      // corrupted-6 safely falls back to key
      expect(viewers).toHaveLength(2);
      expect(viewers.find((v) => v.userId === 'usr-valid-99')).toBeDefined();
      const validViewer = viewers.find((v) => v.userId === 'usr-valid-99');
      expect(validViewer?.avatarUrl).toBeNull();
      const fallbackViewer = viewers.find((v) => v.userId === 'corrupted-6');
      expect(fallbackViewer?.name).toBe('Colleague');
      expect(fallbackViewer?.role).toBe('Staff');
    });

    it('extractViewers filters out current user by ID or by email (case-insensitive)', () => {
      const stateWithCurrentUser: Record<string, unknown> = {
        [mockCurrentUser.id]: [{
          userId: mockCurrentUser.id,
          name: 'Empirical Challenger',
          email: mockCurrentUser.email,
        }],
        'diff-id-same-email': [{
          userId: 'diff-id-99',
          name: 'Challenger Alternate',
          email: mockCurrentUser.email.toUpperCase(), // Case-insensitive match
        }],
        'other-user': [{
          userId: 'usr-legit-colleague',
          name: 'Legit Colleague',
          email: 'legit@ata-lta.ph',
        }],
      };

      const viewers = extractViewers(stateWithCurrentUser, mockCurrentUser.id, mockCurrentUser.email);
      expect(viewers).toHaveLength(1);
      expect(viewers[0]?.userId).toBe('usr-legit-colleague');
    });

    it('getInitials handles pathological names without crashing', () => {
      expect(getInitials('')).toBe('?');
      expect(getInitials('   ')).toBe('?');
      expect(getInitials('A')).toBe('A');
      expect(getInitials('Alexander')).toBe('AL');
      expect(getInitials('Juan Dela Cruz')).toBe('JC');
      expect(getInitials('   Maria    Santos   ')).toBe('MS');
      expect(getInitials('Dr. Jane Doe III')).toBe('DI');
    });

    it('getAvatarColorClass returns valid Tailwind class for arbitrary strings and numbers', () => {
      const class1 = getAvatarColorClass('');
      const class2 = getAvatarColorClass('usr-abc-123');
      const class3 = getAvatarColorClass('⚡🚀🔥');

      expect(typeof class1).toBe('string');
      expect(class1).toContain('bg-');
      expect(typeof class2).toBe('string');
      expect(class2).toContain('bg-');
      expect(typeof class3).toBe('string');
      expect(class3).toContain('bg-');
    });
  });

  // =========================================================================
  // Vector 7: Cross-Surface Work Request Collaboration Parity
  // =========================================================================
  describe('Vector 7: Cross-Surface Work Request Collaboration Parity', () => {
    it('verifies SidePeek and Kanban construct identical channel name "presence:work_request:${id}"', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      // SidePeek mount (omits domain, uses wr-101)
      const { unmount: unmount1 } = render(<PresenceAvatars roomId="wr-101" />);
      expect(channelSpy).toHaveBeenLastCalledWith('presence:work_request:wr-101');
      unmount1();

      // Kanban mount (explicit or omitted domain, uses wr-101)
      const { unmount: unmount2 } = render(<PresenceAvatars roomId="wr-101" domain="work_request" />);
      expect(channelSpy).toHaveBeenLastCalledWith('presence:work_request:wr-101');
      unmount2();

      // Both instances bind to identical realtime channel topic
      expect(channelSpy).toHaveBeenCalledTimes(2);
      expect(supabase.getChannels().length).toBe(0);
    });
  });
});
