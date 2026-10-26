import { useState, type FormEvent } from 'react';
import { Sun, Moon, Laptop, Table, List, LayoutGrid, Check, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateProfile } from '../api/useProfile';
import type { UserProfileData, UserPreferences } from '../api/types';

interface ProfilePreferencesCardProps {
  profile?: UserProfileData;
  isLoading?: boolean;
}

export function ProfilePreferencesCard({ profile, isLoading = false }: ProfilePreferencesCardProps) {
  const existingPrefs = (profile?.preferences as UserPreferences) || {};

  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('erp_theme');
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    }
    return existingPrefs.theme || 'system';
  });

  const [defaultView, setDefaultView] = useState<'table' | 'list' | 'board'>(() => {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('erp_default_view');
      if (stored === 'table' || stored === 'list' || stored === 'board') return stored;
    }
    return existingPrefs.defaultView || 'table';
  });

  const [defaultFormView, setDefaultFormView] = useState<'side-peek' | 'center-peek' | 'full-page' | 'new-tab'>(
    existingPrefs.defaultFormView || 'side-peek'
  );

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const updateProfileMutation = useUpdateProfile();
  const isSaving = updateProfileMutation.isPending;

  const applyThemeToDOM = (selectedTheme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    if (selectedTheme === 'system') {
      localStorage.removeItem('erp_theme');
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (systemDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    } else if (selectedTheme === 'dark') {
      localStorage.setItem('erp_theme', 'dark');
      root.classList.add('dark');
    } else {
      localStorage.setItem('erp_theme', 'light');
      root.classList.remove('dark');
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    applyThemeToDOM(newTheme);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('erp_default_view', defaultView);
      }

      await updateProfileMutation.mutateAsync({
        preferences: {
          ...existingPrefs,
          theme,
          defaultView,
          defaultFormView,
        },
      });

      applyThemeToDOM(theme);
      setStatusMessage({ type: 'success', text: 'Preferences saved successfully.' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to save preferences.';
      setStatusMessage({ type: 'error', text: message });
    }
  };

  return (
    <Card className="border-border/80 shadow-none" data-testid="profile-preferences-card">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-foreground">Preferences</CardTitle>
        <CardDescription>Customize your display settings and interface behaviors.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="profile-preferences-form">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Theme Selector */}
            <div className="space-y-1.5">
              <label
                htmlFor="profile-theme-select"
                className="text-xs font-semibold text-muted-foreground tracking-normal"
              >
                Theme
              </label>
              <Select
                value={theme}
                onValueChange={(val: 'light' | 'dark' | 'system') => handleThemeChange(val)}
                disabled={isLoading || isSaving}
              >
                <SelectTrigger id="profile-theme-select" data-testid="profile-theme-select">
                  <SelectValue placeholder="Select Theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    <div className="flex items-center gap-2">
                      <Sun className="h-4 w-4 text-amber-500" />
                      <span>Light</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="dark">
                    <div className="flex items-center gap-2">
                      <Moon className="h-4 w-4 text-indigo-400" />
                      <span>Dark</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="system">
                    <div className="flex items-center gap-2">
                      <Laptop className="h-4 w-4 text-muted-foreground" />
                      <span>System default</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Default List View */}
            <div className="space-y-1.5">
              <label
                htmlFor="profile-default-view-select"
                className="text-xs font-semibold text-muted-foreground tracking-normal"
              >
                Default List View
              </label>
              <Select
                value={defaultView}
                onValueChange={(val: 'table' | 'list' | 'board') => setDefaultView(val)}
                disabled={isLoading || isSaving}
              >
                <SelectTrigger id="profile-default-view-select" data-testid="profile-default-view-select">
                  <SelectValue placeholder="Select List View" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">
                    <div className="flex items-center gap-2">
                      <Table className="h-4 w-4 text-muted-foreground" />
                      <span>Table</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="list">
                    <div className="flex items-center gap-2">
                      <List className="h-4 w-4 text-muted-foreground" />
                      <span>List</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="board">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      <span>Board</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Default Form View */}
            <div className="space-y-1.5">
              <label
                htmlFor="profile-default-form-view-select"
                className="text-xs font-semibold text-muted-foreground tracking-normal"
              >
                Default Form View
              </label>
              <Select
                value={defaultFormView}
                onValueChange={(val: 'side-peek' | 'center-peek' | 'full-page' | 'new-tab') =>
                  setDefaultFormView(val)
                }
                disabled={isLoading || isSaving}
              >
                <SelectTrigger
                  id="profile-default-form-view-select"
                  data-testid="profile-default-form-view-select"
                >
                  <SelectValue placeholder="Select Form View" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="side-peek">Side peek</SelectItem>
                  <SelectItem value="center-peek">Center peek</SelectItem>
                  <SelectItem value="full-page">Full page</SelectItem>
                  <SelectItem value="new-tab">New tab</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {statusMessage && (
            <div
              className={`flex items-center gap-2 text-xs p-2.5 rounded-[8px] border ${
                statusMessage.type === 'error'
                  ? 'text-destructive bg-destructive/10 border-destructive/20'
                  : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
              }`}
              data-testid="profile-preferences-status"
            >
              {statusMessage.type === 'error' ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <Check className="h-4 w-4 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <Button
              type="submit"
              disabled={isLoading || isSaving}
              className="gap-2"
              data-testid="profile-save-preferences-btn"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Preferences'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
