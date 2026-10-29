import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from './select';

describe('Select Component UI Hardening', () => {
  it('renders SelectTrigger with overflow-hidden, text-left, gap-2, min-w-0, and span truncation', () => {
    const longLabel =
      'WR-ATA-2026-0003 · E2E Full Lifecycle Master Compliance & Regulatory Licensing (2026) (ATA)';

    render(
      <Select defaultValue="wr-3">
        <SelectTrigger data-testid="test-select-trigger">
          <SelectValue placeholder="Choose work request" />
        </SelectTrigger>
        <SelectContent data-testid="test-select-content">
          <SelectItem value="wr-3" data-testid="test-select-item">
            {longLabel}
          </SelectItem>
        </SelectContent>
      </Select>
    );

    const trigger = screen.getByTestId('test-select-trigger');
    expect(trigger).toBeInTheDocument();

    // Verify hardened base classes
    expect(trigger.className).toContain('overflow-hidden');
    expect(trigger.className).toContain('text-left');
    expect(trigger.className).toContain('gap-2');
    expect(trigger.className).toContain('min-w-0');
    expect(trigger.className).toContain('[&>span]:min-w-0');
    expect(trigger.className).toContain('[&>span]:truncate');

    // Verify chevron icon has shrink-0
    const chevron = trigger.querySelector('svg');
    expect(chevron).toBeInTheDocument();
    expect(chevron?.getAttribute('class')).toContain('shrink-0');
    expect(chevron?.getAttribute('class')).toContain('opacity-70');
  });

  it('renders SelectContent with max-w-[calc(100vw-2rem)] and SelectItem with text-left', () => {
    render(
      <Select open={true}>
        <SelectTrigger data-testid="open-trigger">
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent data-testid="open-content">
          <SelectItem value="opt-1" data-testid="open-item">
            Multi-word Option With Long Text Description
          </SelectItem>
        </SelectContent>
      </Select>
    );

    const content = screen.getByTestId('open-content');
    expect(content.className).toContain('max-w-[calc(100vw-2rem)]');

    const item = screen.getByTestId('open-item');
    expect(item.className).toContain('text-left');
  });
});
