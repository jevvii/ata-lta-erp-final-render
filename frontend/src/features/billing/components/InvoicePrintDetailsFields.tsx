import { PRINT_DETAIL_FIELDS } from '../utils/printDetailFields';
import { Input } from '@/components/ui/input';
import type { InvoicePrintDetails } from '@/lib/printDocuments';

export function InvoicePrintDetailsFields({
  value,
  automaticValues = {},
  onChange,
}: {
  value: InvoicePrintDetails;
  automaticValues?: InvoicePrintDetails;
  onChange: React.Dispatch<React.SetStateAction<InvoicePrintDetails>>;
}) {
  return (
    <fieldset className="border-t border-[#E2E8F0] pt-3 space-y-3">
      <legend className="text-sm font-semibold">Statement details</legend>
      <p className="text-xs text-[#475569]">
        Payment details are printed on the statement. Record payments separately to update the
        payment ledger. Noted by uses the template name HENRY WONG unless overridden. Use automatic
        restores the current default without changing recorded payments or signatures.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRINT_DETAIL_FIELDS.map(([key, label]) => {
          const isOverridden = Object.prototype.hasOwnProperty.call(value, key);
          const inputValue = isOverridden ? (value[key] ?? '') : (automaticValues[key] ?? '');
          return (
            <div key={key} className="text-xs font-medium text-[#1E293B] space-y-1">
              <div className="flex min-h-11 sm:min-h-8 flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{label}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded font-normal ${
                      !isOverridden
                        ? 'bg-slate-100 text-slate-600'
                        : value[key] === ''
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {!isOverridden ? 'Automatic' : value[key] === '' ? 'Blank' : 'Custom'}
                  </span>
                </div>
                {isOverridden && (
                  <button
                    type="button"
                    aria-label={`Use automatic for ${label}`}
                    title={`Use automatic for ${label}`}
                    onClick={() => {
                      onChange((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                    }}
                    className="min-h-11 sm:min-h-8 px-2 text-xs text-blue-700 hover:text-blue-800 underline font-normal cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  >
                    Use automatic
                  </button>
                )}
              </div>
              <Input
                aria-label={label}
                value={inputValue}
                maxLength={500}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange((prev) => ({ ...prev, [key]: val }));
                }}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
