import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateInput, type DateInputProps } from './date-input';
import { Dialog, DialogContent, DialogTitle } from './dialog';

function Field(props: Partial<DateInputProps>) {
  const [value, setValue] = useState(props.value ?? '2026-10-11');
  return (
    <DateInput
      aria-label="Date"
      name="date"
      {...props}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        props.onValueChange?.(next);
      }}
    />
  );
}

function desktop() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('pointer: fine'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('shared Material UI date input', () => {
  it('preserves date-only values, form names and clearing', () => {
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <Field onValueChange={onChange} />
      </form>
    );
    const input = screen.getByLabelText('Date', { selector: 'input' });
    fireEvent.change(input, { target: { value: '2026-12-31' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-12-31');
    expect(new FormData(container.querySelector('form')!).get('date')).toBe('2026-12-31');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('never emits impossible date strings and blocks out-of-range form values', () => {
    const onChange = vi.fn();
    render(<Field min="2026-10-01" max="2026-10-31" onValueChange={onChange} />);
    const input = screen.getByLabelText('Date', { selector: 'input' });
    fireEvent.change(input, { target: { value: '2026-02-30' } });
    expect(onChange).not.toHaveBeenCalledWith('2026-02-30');
    onChange.mockClear();
    fireEvent.change(input, { target: { value: '2026-11-01' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toBeInvalid();
    fireEvent.change(input, { target: { value: '2026-10-20' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-20');
    expect(input).toBeValid();
  });

  it('retains required, disabled and read-only behavior', () => {
    const { rerender } = render(<Field value="" required disabled />);
    expect(screen.getByLabelText('Date', { selector: 'input' })).toBeRequired();
    expect(screen.getByLabelText('Date', { selector: 'input' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /choose date/i })).toBeDisabled();
    rerender(<Field value="" required readOnly />);
    expect(screen.getByLabelText('Date', { selector: 'input' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /choose date/i })).toBeDisabled();
  });

  it('selects a calendar day inside a Radix modal without closing the parent', async () => {
    desktop();
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Edit task</DialogTitle>
          <Field onValueChange={onChange} />
        </DialogContent>
      </Dialog>
    );
    fireEvent.click(screen.getByRole('button', { name: /choose date/i }));
    const day = await screen.findByRole('gridcell', { name: '20' });
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toContainElement(day);
    fireEvent.click(day);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('2026-10-20'));
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /choose date/i }));
    fireEvent.keyDown(await screen.findByRole('gridcell', { name: '20' }), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps month-only fields as YYYY-MM when typing and picking a month', async () => {
    desktop();
    const onChange = vi.fn();
    render(<Field type="month" value="2026-10" onValueChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Date', { selector: 'input' }), {
      target: { value: '2026-11' },
    });
    expect(onChange).toHaveBeenLastCalledWith('2026-11');
    fireEvent.click(screen.getByRole('button', { name: /choose date/i }));
    fireEvent.click(await screen.findByRole('radio', { name: 'December' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('2026-12'));
  });

  it('supports the mobile calendar dialog', async () => {
    const onChange = vi.fn();
    render(<Field onValueChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /choose date/i }));
    fireEvent.click(await screen.findByRole('gridcell', { name: '20' }));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('2026-10-20'));
  });

  it('reflects a report filter fallback when its parent replaces an empty date with the current date', async () => {
    function ReportField() {
      const [value, setValue] = useState('2026-10-11');
      return (
        <DateInput
          aria-label="Report date"
          value={value}
          onValueChange={(next) => setValue(next || '2026-10-11')}
        />
      );
    }
    render(<ReportField />);
    fireEvent.change(screen.getByLabelText('Report date', { selector: 'input' }), {
      target: { value: '' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Report date', { selector: 'input' })).toHaveValue('10/11/2026')
    );
  });

  it('displays and accepts MM/DD/YYYY formatted dates while emitting canonical YYYY-MM-DD', () => {
    const onChange = vi.fn();
    render(<Field value="2026-04-19" onValueChange={onChange} />);
    const input = screen.getByLabelText('Date', { selector: 'input' });
    expect(input).toHaveValue('04/19/2026');
    fireEvent.change(input, { target: { value: '12/25/2026' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-12-25');
    expect(input).toHaveValue('12/25/2026');
  });
});
