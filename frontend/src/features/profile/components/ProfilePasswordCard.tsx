import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Sparkles, Check, Circle, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { evaluatePassword, generateSecurePassword } from '../lib/passwordUtils';
import { useChangePassword } from '../api/useProfile';

interface ProfilePasswordCardProps {
  isLoading?: boolean;
}

export function ProfilePasswordCard({ isLoading = false }: ProfilePasswordCardProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const changePasswordMutation = useChangePassword();
  const evalRes = evaluatePassword(newPassword);

  const isSaving = changePasswordMutation.isPending;

  const handleGeneratePassword = () => {
    const generated = generateSecurePassword();
    setNewPassword(generated);
    setConfirmPassword(generated);
    setShowNew(true);
    setShowConfirm(true);
    setErrorMessage(null);

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      void navigator.clipboard.writeText(generated);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!currentPassword) {
      setErrorMessage('Current password is required.');
      return;
    }

    if (!newPassword) {
      setErrorMessage('New password is required.');
      return;
    }

    if (!evalRes.isValid) {
      setErrorMessage('New password must satisfy all 5 security requirements below.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('New passwords do not match.');
      return;
    }

    if (currentPassword === newPassword) {
      setErrorMessage('New password must be different from your current password.');
      return;
    }

    try {
      await changePasswordMutation.mutateAsync({
        currentPassword,
        newPassword,
      });

      setSuccessMessage('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to update password.';
      setErrorMessage(message);
    }
  };

  const rules = [
    { key: 'length', label: '8–128 characters', met: evalRes.checks.length },
    { key: 'upper', label: 'Uppercase letter (A–Z)', met: evalRes.checks.upper },
    { key: 'lower', label: 'Lowercase letter (a–z)', met: evalRes.checks.lower },
    { key: 'number', label: 'Numeric digit (0–9)', met: evalRes.checks.number },
    { key: 'special', label: 'Special character (e.g. !@#$)', met: evalRes.checks.special },
  ];

  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;

  return (
    <Card className="border-[#E2E8F0] dark:border-zinc-800 shadow-none" data-testid="profile-password-card">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-foreground">Change Password</CardTitle>
        <CardDescription>Use a strong password meeting modern security complexity requirements.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="profile-password-form">
          {/* Current Password */}
          <div className="space-y-1.5">
            <label
              htmlFor="profile-current-password"
              className="text-xs font-semibold text-muted-foreground tracking-normal"
            >
              Current Password
            </label>
            <div className="relative">
              <Input
                id="profile-current-password"
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setErrorMessage(null);
                }}
                disabled={isLoading || isSaving}
                placeholder="•••••••••••••"
                className="pr-10"
                required
                data-testid="profile-current-password-input"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-[6px] transition-colors"
                title={showCurrent ? 'Hide password' : 'Show password'}
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
                data-testid="toggle-current-password-visibility"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New & Confirm Password Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* New Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="profile-new-password"
                  className="text-xs font-semibold text-muted-foreground tracking-normal"
                >
                  New Password
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGeneratePassword}
                  disabled={isLoading || isSaving}
                  className="h-6 px-2 text-xs font-medium gap-1 text-primary border-primary/30 hover:bg-primary/5"
                  data-testid="generate-password-btn"
                >
                  <Sparkles className="h-3 w-3" />
                  Generate Password
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="profile-new-password"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  disabled={isLoading || isSaving}
                  placeholder="Enter new secure password"
                  className={`pr-10 ${
                    evalRes.val.length > 0
                      ? evalRes.isValid
                        ? 'border-emerald-500 ring-1 ring-emerald-500/20'
                        : 'border-amber-500/50'
                      : ''
                  }`}
                  required
                  data-testid="profile-new-password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-[6px] transition-colors"
                  title={showNew ? 'Hide password' : 'Show password'}
                  aria-label={showNew ? 'Hide password' : 'Show password'}
                  data-testid="toggle-new-password-visibility"
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="profile-confirm-password"
                  className="text-xs font-semibold text-muted-foreground tracking-normal"
                >
                  Confirm New Password
                </label>
                {confirmPassword && (
                  <span
                    className={`text-xs uppercase font-bold tracking-wider px-2 py-0.5 rounded-[6px] ${
                      passwordsMatch
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-destructive/10 text-destructive border-destructive/20'
                    }`}
                    data-testid="password-match-badge"
                  >
                    {passwordsMatch ? '✓ Match' : '✕ No match'}
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  id="profile-confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  disabled={isLoading || isSaving}
                  placeholder="Repeat new password"
                  className={`pr-10 ${
                    confirmPassword.length > 0
                      ? passwordsMatch
                        ? 'border-emerald-500 ring-1 ring-emerald-500/20'
                        : 'border-destructive ring-1 ring-destructive/20'
                      : ''
                  }`}
                  required
                  data-testid="profile-confirm-password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-[6px] transition-colors"
                  title={showConfirm ? 'Hide password' : 'Show password'}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  data-testid="toggle-confirm-password-visibility"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Real-time Guardrails & Strength Meter */}
          <div
            className="rounded-[8px] border-[#E2E8F0] dark:border-zinc-800 bg-muted/20 p-4 space-y-3"
            data-testid="password-guardrails-container"
          >
            {/* Strength Meter Header */}
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Password Strength</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-[6px] tracking-normal ${
                  evalRes.strength === 'strong'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : evalRes.strength === 'good'
                    ? 'bg-[#F8FAFC]0/15 text-[#1E293B] dark:text-blue-400'
                    : evalRes.strength === 'fair'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : evalRes.strength === 'weak'
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-muted text-muted-foreground border-[#E2E8F0] dark:border-zinc-800'
                }`}
                data-testid="password-strength-badge"
              >
                {evalRes.strength === 'none' ? 'Required' : evalRes.label}
              </span>
            </div>

            {/* 4 segments */}
            <div className="flex gap-1.5 h-1.5 w-full">
              {[0, 1, 2, 3].map((idx) => {
                const isActive = idx < evalRes.activeSegments;
                let bgColor = 'bg-border';
                if (isActive) {
                  if (evalRes.strength === 'strong') bgColor = 'bg-emerald-500';
                  else if (evalRes.strength === 'good') bgColor = 'bg-[#F8FAFC]0';
                  else if (evalRes.strength === 'fair') bgColor = 'bg-amber-500';
                  else if (evalRes.strength === 'weak') bgColor = 'bg-destructive';
                }
                return (
                  <div
                    key={idx}
                    className={`flex-1 rounded-[6px] transition-colors duration-200 ${bgColor}`}
                    data-testid={`password-strength-segment-${idx}`}
                  />
                );
              })}
            </div>

            {/* Criteria Checklist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border/50">
              {rules.map((rule) => (
                <div
                  key={rule.key}
                  className={`flex items-center gap-2 text-xs py-1 px-2 rounded-[6px] transition-colors ${
                    rule.met
                      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 font-medium'
                      : 'text-muted-foreground bg-background/50'
                  }`}
                  data-testid={`rule-item-${rule.key}`}
                >
                  {rule.met ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                  )}
                  <span>{rule.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Error & Success States */}
          {errorMessage && (
            <div
              className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border-destructive/20 p-2.5 rounded-[6px]"
              data-testid="password-error-message"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div
              className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20 p-2.5 rounded-[6px]"
              data-testid="password-success-message"
            >
              <Check className="h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Form Actions */}
          <div className="pt-2 flex justify-end">
            <Button
              type="submit"
              disabled={isLoading || isSaving}
              className="gap-2"
              data-testid="profile-update-password-btn"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
