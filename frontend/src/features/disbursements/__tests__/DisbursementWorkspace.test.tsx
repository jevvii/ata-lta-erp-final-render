import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DisbursementWorkspace } from '../components/workspace/DisbursementWorkspace';

describe('DisbursementWorkspace Component', () => {
  it('renders grid slot and detail slot without rail by default', () => {
    const onToggleDetail = vi.fn();
    render(
      <DisbursementWorkspace
        grid={<div data-testid="test-grid">Grid Content</div>}
        detail={<div data-testid="test-detail">Detail Content</div>}
        detailCollapsed={false}
        onToggleDetail={onToggleDetail}
      />
    );

    expect(screen.getByTestId('test-grid')).toBeInTheDocument();
    expect(screen.getByTestId('test-detail')).toBeInTheDocument();
    expect(screen.queryByTestId('disbursement-workspace-rail')).not.toBeInTheDocument();

    const detailPane = screen.getByTestId('disbursement-workspace-detail');
    expect(detailPane).toHaveAttribute('id', 'disbursement-detail-pane');
    expect(detailPane).toHaveStyle({ width: 'var(--pane-detail-width)' });
  });

  it('renders rail slot when rail prop is provided', () => {
    render(
      <DisbursementWorkspace
        rail={<div data-testid="test-rail">Rail Content</div>}
        grid={<div>Grid</div>}
        detail={<div>Detail</div>}
        detailCollapsed={false}
        onToggleDetail={vi.fn()}
      />
    );

    expect(screen.getByTestId('disbursement-workspace-rail')).toBeInTheDocument();
    expect(screen.getByTestId('test-rail')).toBeInTheDocument();
  });

  it('toggles detail pane collapse state with proper aria attributes', () => {
    const onToggleDetail = vi.fn();

    const { rerender } = render(
      <DisbursementWorkspace
        grid={<div>Grid</div>}
        detail={<div>Detail Content</div>}
        detailCollapsed={false}
        onToggleDetail={onToggleDetail}
      />
    );

    const hideBtn = screen.getByRole('button', { name: /hide details/i });
    expect(hideBtn).toHaveAttribute('aria-expanded', 'true');
    expect(hideBtn).toHaveAttribute('aria-controls', 'disbursement-detail-pane');

    fireEvent.click(hideBtn);
    expect(onToggleDetail).toHaveBeenCalledTimes(1);

    // Re-render collapsed
    rerender(
      <DisbursementWorkspace
        grid={<div>Grid</div>}
        detail={<div>Detail Content</div>}
        detailCollapsed={true}
        onToggleDetail={onToggleDetail}
      />
    );

    const showBtn = screen.getByRole('button', { name: /show details/i });
    expect(showBtn).toHaveAttribute('aria-expanded', 'false');
    expect(showBtn).toHaveAttribute('aria-controls', 'disbursement-detail-pane');

    const detailPane = screen.getByTestId('disbursement-workspace-detail');
    expect(detailPane).toHaveStyle({ width: 'var(--pane-detail-collapsed)' });
  });

  it('renders bottom container as hidden container for future branch 06', () => {
    render(
      <DisbursementWorkspace
        grid={<div>Grid</div>}
        bottom={<div data-testid="test-bottom">Bottom lines</div>}
        detailCollapsed={false}
        onToggleDetail={vi.fn()}
      />
    );

    const bottomContainer = screen.getByTestId('disbursement-workspace-bottom');
    expect(bottomContainer).toHaveClass('hidden');
    expect(screen.getByTestId('test-bottom')).toBeInTheDocument();
  });
});
