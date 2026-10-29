import { useState, useRef, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useUploadAvatar, useUpdateProfile } from '../api/useProfile';
import type { UserProfileData } from '../api/types';

interface ProfileDetailsCardProps {
  profile?: UserProfileData;
  isLoading?: boolean;
}

export function ProfileDetailsCard({ profile, isLoading = false }: ProfileDetailsCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState<string>(profile?.name || '');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (profile?.name !== undefined) {
      setName(profile.name);
    }
  }, [profile?.name]);

  const uploadAvatarMutation = useUploadAvatar();
  const updateProfileMutation = useUpdateProfile();

  const isSaving = uploadAvatarMutation.isPending || updateProfileMutation.isPending;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setStatusMessage({ type: 'error', text: 'File size exceeds 5MB limit.' });
      e.target.value = '';
      return;
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setStatusMessage({ type: 'error', text: 'Supported formats: PNG, JPEG, WebP.' });
      e.target.value = '';
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

    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatusMessage({ type: 'error', text: 'Full name cannot be empty.' });
      return;
    }

    try {
      if (selectedFile) {
        setStatusMessage({ type: 'info', text: 'Uploading avatar photo...' });
        await uploadAvatarMutation.mutateAsync(selectedFile);
      }

      if (trimmedName && trimmedName !== profile?.name) {
        setStatusMessage({ type: 'info', text: 'Saving profile details...' });
        await updateProfileMutation.mutateAsync({ name: trimmedName });
      }

      setStatusMessage({ type: 'success', text: 'Details saved successfully.' });
      setSelectedFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

  return (
    <Card className="border-[#E2E8F0] dark:border-zinc-800 shadow-none" data-testid="profile-details-card">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-foreground">Your Details</CardTitle>
        <CardDescription>Update your name and profile photo.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Avatar Upload Row */}
        <div className="flex items-center gap-5 pb-6 border-b border-[#E2E8F0] dark:border-zinc-800">
          <UserAvatar
            data-testid="profile-avatar-circle"
            userId={profile?.id}
            name={name || displayName}
            email={profile?.email}
            avatarUrl={displayAvatar}
            shape="rounded"
            className="h-20 w-20 rounded-[6px] text-xl border border-[#E2E8F0] dark:border-zinc-800"
            imgClassName="hidden"
          />

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
            <label htmlFor="profile-name" className="text-xs font-semibold text-muted-foreground tracking-normal">
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
            <label htmlFor="profile-email" className="text-xs font-semibold text-muted-foreground tracking-normal">
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
