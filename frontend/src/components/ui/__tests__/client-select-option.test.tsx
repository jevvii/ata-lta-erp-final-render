import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ClientSelectOptionContent,
  ClientSelectSearchHeader,
} from '../client-select-option';

describe('client-select-option components', () => {
  describe('ClientSelectOptionContent', () => {
    it('renders clean primary label without TIN in trigger when non-duplicate and never renders DBA', () => {
      const client = {
        id: 'c1',
        name: 'Alpha Holdings Corp',
        tin: '123-456-789-000',
        tradeName: 'Alpha Store',
      };

      render(
        <ClientSelectOptionContent client={client} isDuplicate={false} />
      );

      // Primary name should be rendered
      expect(screen.getByText('Alpha Holdings Corp')).toBeInTheDocument();

      // DBA badge should NOT be rendered anywhere in the option
      expect(screen.queryByTestId('client-option-dba')).toBeNull();
      expect(screen.queryByText(/DBA:/i)).toBeNull();
      expect(screen.queryByText('Alpha Store')).toBeNull();

      // TIN pill should have hidden outside viewport class
      const tinBadge = screen.getByTestId('client-option-tin');
      expect(tinBadge).toHaveTextContent('123-456-789-000');
      expect(tinBadge.className).toContain('hidden [[data-radix-select-viewport]_&]:inline-flex');
    });

    it('renders inline TIN bullet in trigger when duplicate is true', () => {
      const client = {
        id: 'c2',
        name: 'Beta Global Inc',
        tin: '987-654-321-001',
        tradeName: 'Beta Store',
      };

      render(<ClientSelectOptionContent client={client} isDuplicate={true} />);

      // DBA badge should NOT be rendered
      expect(screen.queryByTestId('client-option-dba')).toBeNull();
      expect(screen.queryByText(/DBA:/i)).toBeNull();

      const tinBadge = screen.getByTestId('client-option-tin');
      expect(tinBadge.className).toContain('inline-flex');
      expect(tinBadge.textContent).toContain('987-654-321-001');
      // Contains bullet for trigger view
      expect(tinBadge.textContent).toContain('•');
    });

    it('renders client number and entity when requested', () => {
      const client = {
        id: 'c3',
        name: 'Gamma Corp',
        clientNumber: 'C-0099',
        entity: 'ATA',
      };

      render(
        <ClientSelectOptionContent
          client={client}
          showEntity={true}
          showClientNumber={true}
        />
      );

      expect(screen.getByText(/C-0099 · Gamma Corp \(ATA\)/)).toBeInTheDocument();
    });
  });

  describe('ClientSelectSearchHeader', () => {
    it('renders search input with default "Search name or TIN..." placeholder and responds to input changes and clear button', () => {
      const handleChange = vi.fn();
      const { rerender } = render(
        <ClientSelectSearchHeader value="" onChange={handleChange} />
      );

      const input = screen.getByTestId('client-select-search-input');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('placeholder', 'Search name or TIN...');

      fireEvent.change(input, { target: { value: 'search text' } });
      expect(handleChange).toHaveBeenCalledWith('search text');

      // Rerender with value present to show clear button
      rerender(<ClientSelectSearchHeader value="search text" onChange={handleChange} />);
      const clearBtn = screen.getByLabelText(/Clear search/i);
      expect(clearBtn).toBeInTheDocument();

      fireEvent.click(clearBtn);
      expect(handleChange).toHaveBeenCalledWith('');
    });

    it('renders sort selector with DEFAULT_CLIENT_SORT and notifies onSortChange', () => {
      const handleSortChange = vi.fn();
      render(
        <ClientSelectSearchHeader
          value=""
          onChange={vi.fn()}
          sortBy="id_asc"
          onSortChange={handleSortChange}
        />
      );

      const sortSelect = screen.getByTestId('client-select-sort') as HTMLSelectElement;
      expect(sortSelect).toBeInTheDocument();
      expect(sortSelect.value).toBe('id_asc');

      fireEvent.change(sortSelect, { target: { value: 'name_asc' } });
      expect(handleSortChange).toHaveBeenCalledWith('name_asc');
    });
  });
});
