import { useRef, useState } from 'react';
import { CheckSquare, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ChecklistItem } from '../api/types';

interface TaskChecklistProps {
  items: ChecklistItem[];
  canEdit: boolean;
  canComplete: boolean;
  ready: boolean;
  loading: boolean;
  loadError: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onRetry: () => void;
  onChange: (items: ChecklistItem[]) => Promise<unknown>;
  onToggle: (id: string, completed: boolean) => Promise<unknown>;
}

const typeClass = (category?: string | null) => category === 'document'
  ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]'
  : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]';

export function TaskChecklist({
  items, canEdit, canComplete, ready, loading, loadError, disabled, disabledReason, onRetry, onChange, onToggle,
}: TaskChecklistProps) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<'subtask' | 'document'>('subtask');
  const [year, setYear] = useState('');
  const [includeYear, setIncludeYear] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const locked = !ready || loading || loadError || disabled || saving;
  const editLocked = locked || !canEdit;
  const controlClass = 'h-8 rounded-[6px] border border-[#CBD5E1] bg-white px-2 text-xs text-[#1E293B] disabled:cursor-not-allowed';

  const save = async (action: () => Promise<unknown>) => {
    if (locked || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save checklist. Please try again.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveItems = (next: ChecklistItem[]) => {
    if (editLocked) return Promise.resolve(false);
    return save(() => onChange(next));
  };

  const addItem = async () => {
    if (!text.trim() || editLocked) return;
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
    if (await saveItems([...items, {
      id, text: text.trim(), completed: false, category,
      periodYear: category === 'document' && includeYear ? year.trim() || null : null,
    }])) setText('');
  };

  return (
    <section className="space-y-2" aria-label="Task checklist" aria-busy={loading || saving}>
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-[#475569]">
        <CheckSquare className="h-3.5 w-3.5" />
        {ready && !loadError
          ? `Checklist (${items.filter((item) => item.completed).length}/${items.length})`
          : 'Checklist'}
      </h4>

      {loadError || (!loading && !ready) ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[#CBD5E1] p-3 text-xs text-[#475569]">
          <span>Unable to load checklist. Retry before making changes.</span>
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>Retry</Button>
        </div>
      ) : loading && !ready ? (
        <p role="status" className="p-3 text-xs text-[#475569]">Loading checklist…</p>
      ) : items.length > 0 ? (
        <div className="divide-y divide-[#E2E8F0] rounded-[6px] border border-[#E2E8F0] bg-white px-3">
          {items.map((item) => {
            const dependencies = item.dependsOn ? [item.dependsOn].flat() : [];
            const blocked = dependencies.some((id) => items.some((other) => other.id === id && !other.completed));
            return (
              <div key={item.id} className="py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-w-0 basis-full items-center gap-2 sm:basis-0 sm:flex-1">
                    <input type="checkbox" checked={item.completed}
                      onChange={() => { if (canComplete && !locked) void save(() => onToggle(item.id, !item.completed)); }}
                      disabled={locked || !canComplete || (blocked && !item.completed)}
                      title={blocked ? 'Waiting for prerequisite checklist items' : disabledReason}
                      className="rounded accent-[#1D4ED8]" />
                    <span className={`break-words ${item.completed ? 'text-[#475569] line-through' : 'font-medium text-[#1E293B]'}`}>{item.text}</span>
                  </label>
                  <span className={`ml-5 inline-flex shrink-0 items-center gap-1 rounded-[6px] border px-2 py-1 sm:ml-0 ${typeClass(item.category)}`}>
                    {item.category === 'document' ? <><FileText className="h-3 w-3" /> Doc</> : 'Sub-task'}
                  </span>
                  {item.category === 'document' && item.periodYear?.trim() && (
                    <span className="text-[#475569]" aria-label={`Document year for ${item.text}`}>{item.periodYear}</span>
                  )}
                  {item.assigneeName && <span className="text-[#475569]">{item.assigneeName}</span>}
                  {canEdit && (
                    <Button type="button" size="xs" variant="ghost" disabled={editLocked} title={disabledReason}
                      aria-label={`Edit checklist item ${item.text}`} onClick={() => { setEditing({ ...item }); setSaveError(null); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {canEdit && editing?.id === item.id && (
                  <form className="mt-3 space-y-3 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3"
                    aria-label={`Edit ${item.text}`} onSubmit={async (event) => {
                      event.preventDefault();
                      if (!editing.text.trim()) { setSaveError('Checklist text is required.'); return; }
                      if (await saveItems(items.map((current) => current.id === item.id ? { ...current, text: editing.text.trim(), category: editing.category, periodYear: editing.periodYear?.trim() || null } : current))) setEditing(null);
                    }}>
                    <label className="block space-y-1 font-medium text-[#475569]">
                      <span>Checklist text</span>
                      <Input aria-label="Checklist text" value={editing.text} maxLength={500} disabled={editLocked}
                        onChange={(event) => setEditing({ ...editing, text: event.target.value })} className={controlClass} />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <select aria-label="Checklist item type" value={editing.category === 'document' ? 'document' : 'subtask'} disabled={editLocked}
                        onChange={(event) => setEditing({ ...editing, category: event.target.value })} className={`${controlClass} ${typeClass(editing.category)}`}>
                        <option value="subtask">Sub-task</option><option value="document">Doc</option>
                      </select>
                      {editing.category === 'document' && (editing.periodYear !== null && editing.periodYear !== undefined ? (
                        <>
                          <Input aria-label="Document year (optional)" placeholder="Year (optional)" maxLength={100} value={editing.periodYear}
                            disabled={editLocked} onChange={(event) => setEditing({ ...editing, periodYear: event.target.value })} className={`${controlClass} w-32`} />
                          <Button type="button" variant="ghost" size="xs" disabled={editLocked}
                            onClick={() => setEditing({ ...editing, periodYear: null })}>Remove year</Button>
                        </>
                      ) : <Button type="button" variant="outline" size="xs" disabled={editLocked}
                        onClick={() => setEditing({ ...editing, periodYear: '' })}>Add year</Button>)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="submit" size="xs" disabled={editLocked || !editing.text.trim()}>Save item</Button>
                      <Button type="button" size="xs" variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
                      <Button type="button" size="xs" variant="ghost" disabled={editLocked}
                        aria-label={`Remove checklist item ${item.text}`} onClick={async () => {
                          const next = items.filter((current) => current.id !== item.id).map((current) => {
                            const dependencies = current.dependsOn ? [current.dependsOn].flat() : [];
                            return dependencies.includes(item.id)
                              ? { ...current, dependsOn: dependencies.filter((id) => id !== item.id) } : current;
                          });
                          if (await saveItems(next)) setEditing(null);
                        }}><Trash2 className="h-3.5 w-3.5" /> Remove item</Button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-center text-xs italic text-[#475569]">No checklist items yet.</p>
      )}

      {canEdit && (
        <div className="space-y-2 pt-1">
          <label className="block text-xs font-medium text-[#475569]" htmlFor="new-task-checklist-text">New checklist item</label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="new-task-checklist-text" placeholder="Add a new checklist item..." value={text} maxLength={500}
              onChange={(event) => setText(event.target.value)} disabled={editLocked} title={disabledReason}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void addItem(); }
              }} className={`${controlClass} min-w-40 flex-1`} />
            <select aria-label="New checklist item type" value={category} disabled={editLocked} title={disabledReason}
              onChange={(event) => setCategory(event.target.value as 'subtask' | 'document')} className={`${controlClass} ${typeClass(category)}`}>
              <option value="subtask">Sub-task</option><option value="document">Doc</option>
            </select>
            <Button type="button" size="xs" onClick={() => void addItem()} disabled={editLocked || !text.trim()}
              title={disabledReason} className="h-8 gap-1 rounded-[6px] text-xs">
              <Plus className="h-3.5 w-3.5" />{saving ? 'Saving…' : 'Add'}
            </Button>
          </div>
          {category === 'document' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#475569]">
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeYear} disabled={editLocked}
                onChange={(event) => setIncludeYear(event.target.checked)} />Include year (optional)</label>
              {includeYear && <Input aria-label="New document year" type="text" inputMode="numeric" placeholder="Year (optional)" maxLength={100}
                value={year} onChange={(event) => setYear(event.target.value)} disabled={editLocked} className={`${controlClass} w-32`} />}
            </div>
          )}
        </div>
      )}
      {saveError && <p role="alert" className="text-xs text-[#991B1B]">{saveError}</p>}
    </section>
  );
}
