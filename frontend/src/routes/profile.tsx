import { User } from 'lucide-react';
import { useProfile } from '@/features/profile/api/useProfile';
import { ProfileDetailsCard } from '@/features/profile/components/ProfileDetailsCard';
import { ProfilePasswordCard } from '@/features/profile/components/ProfilePasswordCard';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfilePage() {
  const { data: profile, isLoading } = useProfile();

  return (
    <div className="w-full space-y-6" data-testid="profile-page">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Account</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Profile</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <User className="h-6 w-6 text-[#1D4ED8]" />
            Profile
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">Manage your account information and security.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-[8px] border border-[#E2E8F0]" />
          <Skeleton className="h-72 w-full rounded-[8px] border border-[#E2E8F0]" />
        </div>
      ) : (
        <div className="space-y-6">
          <ProfileDetailsCard profile={profile} isLoading={isLoading} />
          <ProfilePasswordCard isLoading={isLoading} />
        </div>
      )}
    </div>
  );
}
