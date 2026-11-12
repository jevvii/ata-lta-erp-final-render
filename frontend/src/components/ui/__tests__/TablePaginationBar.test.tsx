import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TablePaginationBar } from '../TablePaginationBar';

describe('TablePaginationBar Component', () => {
  it('renders correctly with standard pagination numbers', () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <TablePaginationBar
        total={100}
        page={2}
        pageSize={25}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        itemLabel="clients"
      />
    );

    // Showing 26 to 50 of 100 clients
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getAllByText('50').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('100').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/clients/)).toBeInTheDocument();

    // Page indicator
    expect(screen.getByTestId('page-indicator')).toHaveTextContent('Page 2 of 4');

    // Prev / Next buttons
    const prevBtn = screen.getByTestId('pagination-prev');
    const nextBtn = screen.getByTestId('pagination-next');
    expect(prevBtn).not.toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    fireEvent.click(prevBtn);
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('handles pageSize = "all" (View All)', () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <TablePaginationBar
        total={73}
        page={1}
        pageSize="all"
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        itemLabel="invoices"
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getAllByText('73').length).toBe(2); // end and total
    expect(screen.getByTestId('page-indicator')).toHaveTextContent('Page 1 of 1');

    // Both buttons should be disabled in View All
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeDisabled();

    // Select should have value "all"
    const select = screen.getByLabelText('Rows per page') as HTMLSelectElement;
    expect(select.value).toBe('all');

    fireEvent.change(select, { target: { value: '10' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(10);
  });

  it('handles total = 0 gracefully', () => {
    render(
      <TablePaginationBar
        total={0}
        page={1}
        pageSize={50}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getAllByText('0').length).toBe(3); // 0 to 0 of 0
    expect(screen.getByTestId('page-indicator')).toHaveTextContent('Page 1 of 1');
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });
});
