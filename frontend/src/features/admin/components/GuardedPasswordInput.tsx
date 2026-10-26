import React, { useState, useId } from 'react';
import { Eye, EyeOff, Sparkles, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { PASSWORD_CRITERIA, generateSecurePassword } from '../utils/password';

export interface GuardedPasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  showGenerator?: boolean;
}

export function GuardedPasswordInput({
  value,
  onChange,
  placeholder = 'Enter password...',
  disabled = false,
  required = false,
  id: customId,
  name = 'password',
  className = '',
  showGenerator = true,
}: GuardedPasswordInputProps) {
  const generatedId = useId();
  const inputId = customId || generatedId;
  const [showPassword, setShowPassword] = useState(false);

  const passedCriteriaCount = PASSWORD_CRITERIA.filter((c) => c.test(value)).length;

  // Strength tier: 0 = none, 1 = weak (1-2), 2 = fair (3), 3 = good (4), 4 = strong (5)
  let strengthTier = 0;
  let strengthLabel = 'None';
  let strengthColorClass = 'bg-[#CBD5E1]';

  if (value.length > 0) {
    if (passedCriteriaCount <= 2) {
      strengthTier = 1;
      strengthLabel = 'Weak';
      strengthColorClass = 'bg-rose-500';
    } else if (passedCriteriaCount === 3) {
      strengthTier = 2;
      strengthLabel = 'Fair';
      strengthColorClass = 'bg-amber-500';
    } else if (passedCriteriaCount === 4) {
      strengthTier = 3;
      strengthLabel = 'Good';
      strengthColorClass = 'bg-[#F8FAFC]0';
    } else if (passedCriteriaCount === 5) {
      strengthTier = 4;
      strengthLabel = 'Strong';
      strengthColorClass = 'bg-emerald-500';
    }
  }

  const handleGenerate = async (e: React.MouseEvent) => {
    e.preventDefault();
    const newPassword = generateSecurePassword(16);
    onChange(newPassword);
    setShowPassword(true);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(newPassword);
        toast.success('Generated secure password copied to clipboard!');
      } else {
        toast.success('Generated secure password applied.');
      }
    } catch {
      toast.success('Generated secure password applied.');
    }
  };

  return (
    <div className={`space-y-2 ${className}`} data-testid="guarded-password-container">
      {/* Input Row with Toggle & Generate */}
      <div className="relative flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            id={inputId}
            name={name}
            type={showPassword ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            className="pr-10 text-sm font-mono"
            data-testid="guarded-password-input"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            disabled={disabled}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#475569] hover:text-[#475569] focus:outline-hidden disabled:opacity-50"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            data-testid="guarded-password-toggle"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {showGenerator && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={disabled}
            className="h-9 shrink-0 gap-1 text-xs font-medium text-[#1E293B] hover:text-[#1E293B] hover:border-[#E2E8F0]"
            data-testid="guarded-password-generate"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#1E293B]" />
            Generate
          </Button>
        )}
      </div>

      {/* Strength Meter (4-Tier Segmented Bar) */}
      <div className="space-y-1" data-testid="guarded-password-meter">
        <div className="flex items-center justify-between text-xs text-[#475569]">
          <span>Password Strength:</span>
          <span
            className={`font-semibold ${
              strengthTier === 4
                ? 'text-emerald-600'
                : strengthTier === 3
                  ? 'text-[#1E293B]'
                  : strengthTier === 2
                    ? 'text-amber-600'
                    : strengthTier === 1
                      ? 'text-rose-600'
                      : 'text-[#475569]'
            }`}
            data-testid="guarded-password-strength-label"
          >
            {strengthLabel}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full">
          {[1, 2, 3, 4].map((seg) => (
            <div
              key={seg}
              className={`h-full rounded-[6px] transition-colors ${
                seg <= strengthTier ? strengthColorClass : 'bg-[#CBD5E1]'
              }`}
              data-testid={`guarded-password-seg-${seg}`}
            />
          ))}
        </div>
      </div>

      {/* 5-Criteria Live Checklist */}
      <div className="rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC]/70 p-2.5 space-y-1 text-xs">
        <p className="font-medium text-[#1E293B] pb-0.5">Password Requirements:</p>
        <ul className="space-y-1" data-testid="guarded-password-checklist">
          {PASSWORD_CRITERIA.map((criterion) => {
            const isMet = criterion.test(value);
            return (
              <li
                key={criterion.id}
                className={`flex items-center gap-1.5 transition-colors ${
                  isMet ? 'text-emerald-700 font-medium' : 'text-[#475569]'
                }`}
                data-testid={`guarded-password-criterion-${criterion.id}`}
                data-status={isMet ? 'met' : 'unmet'}
              >
                {isMet ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                )}
                <span>{criterion.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
