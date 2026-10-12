import { useState, useRef, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUploadAvatar, useUpdateProfile } from '../api/useProfile';
import type { UserProfileData } from '../api/types';

interface ProfileDetailsCardProps {
  profile?: UserProfileData;
  isLoading?: boolean;
}

function getInitials(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return 'U';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase() || 'U';
}

export function ProfileDetailsCard({ profile, isLoading = false }: ProfileDetailsCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState<string>(profile?.name || '');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  const uploadAvatarMutation = useUploadAvatar();
  const updateProfileMutation = useUpdateProfile();

  const isSaving = uploadAvatarMutation.isPending || updateProfileMutation.isPending;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setStatusMessage({ type: 'error', text: 'File size exceeds 5MB limit.' });
      return;
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setStatusMessage({ type: 'error', text: 'Supported formats: PNG, JPEG, WebP.' });
      return;
    }

    setSelectedFile(file);
    setStatusMessage({ type: 'info', text: file.name });

    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    try {
      if (selectedFile) {
        setStatusMessage({ type: 'info', text: 'Uploading avatar photo...' });
        await uploadAvatarMutation.mutateAsync(selectedFile);
      }

      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== profile?.name) {
        setStatusMessage({ type: 'info', text: 'Saving profile details...' });
        await updateProfileMutation.mutateAsync({ name: trimmedName });
      }

      setStatusMessage({ type: 'success', text: 'Details saved successfully.' });
      setSelectedFile(null);
    } catch (err: unknown) {
      let message = 'Unable to save details.';
      if (err instanceof Error) {
        message = err.message;
        if (message.includes('row-level security policy') || message.includes('Failed to create signed upload URL')) {
          message = 'Unable to generate secure upload URL. Please try again.';
        }
      }
      setStatusMessage({ type: 'error', text: message });
    }
  };

  const displayName = profile?.name || 'User';
  const displayAvatar = previewUrl || profile?.avatarUrl;
  const initials = getInitials(name || displayName);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [displayAvatar]);

  return (
    <Card className="border border-[#f0f0f5] dark:border-zinc-800 shadow-xs" data-testid="profile-details-card">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-foreground">Your Details</CardTitle>
        <CardDescription>Update your name and profile photo.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Avatar Upload Row */}
        <div className="flex items-center gap-5 pb-6 border-b border-[#f0f0f5] dark:border-zinc-800">
          <div
            className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary overflow-hidden border border-[#f0f0f5] dark:border-zinc-800"
            style={
              displayAvatar && !avatarLoadFailed
                ? {
                    backgroundImage: `url('${displayAvatar}')`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : undefined
            }
            data-testid="profile-avatar-circle"
          >
            {(!displayAvatar || avatarLoadFailed) && initials}
            {displayAvatar && !avatarLoadFailed && (
              <img
                src={displayAvatar}
                alt=""
                className="hidden"
                onError={() => setAvatarLoadFailed(true)}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-base font-semibold text-foreground" data-testid="profile-display-name">
              {name || displayName}
            </span>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading || isSaving}
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 text-xs h-8"
                data-testid="profile-upload-trigger"
              >
                <Camera className="h-3.5 w-3.5" />
                Upload a new photo
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={isLoading || isSaving}
                onChange={handleFileChange}
                data-testid="profile-avatar-input"
              />
            </div>
            {statusMessage && (
              <span
                className={`text-xs flex items-center gap-1.5 font-medium ${
                  statusMessage.type === 'error'
                    ? 'text-destructive'
                    : statusMessage.type === 'success'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground'
                }`}
                data-testid="profile-avatar-status"
              >
                {statusMessage.type === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
                {statusMessage.type === 'success' && <Check className="h-3.5 w-3.5" />}
                {statusMessage.text}
              </span>
            )}
          </div>
        </div>

        {/* Profile Details Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4" data-testid="profile-details-form">
          <div className="space-y-1.5">
            <label htmlFor="profile-name" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Full Name
            </label>
            <Input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading || isSaving}
              placeholder="e.g. Juan dela Cruz"
              required
              data-testid="profile-name-input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="profile-email" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Email Address
            </label>
            <Input
              id="profile-email"
              type="email"
              value={profile?.email || ''}
              disabled
              readOnly
              className="bg-muted/40 cursor-not-allowed text-muted-foreground"
              data-testid="profile-email-input"
            />
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="submit"
              disabled={isLoading || isSaving}
              className="gap-2"
              data-testid="profile-save-details-btn"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Details'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
