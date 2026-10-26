import type { ComponentType } from 'react';
import {
  Clock,
  Layers,
  Zap,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Ban,
  DollarSign,
  Receipt,
  PauseCircle,
  Inbox,
  UserCheck,
  ClipboardList,
  UserPlus,
  Eye,
  CreditCard,
  Send,
  CheckCircle,
} from 'lucide-react';

export interface PhaseBadgeInfo {
  label: string;
  badgeClass: string;
  dotClass: string;
  Icon: ComponentType<{ className?: string }>;
}

export interface StatusBadgeInfo {
  label: string;
  badgeClass: string;
  dotClass: string;
  Icon: ComponentType<{ className?: string }>;
}

export function getPhaseBadgeInfo(phase?: string | null): PhaseBadgeInfo {
  const normPhase = (phase || 'pre_processing').toLowerCase();

  switch (normPhase) {
    case 'pre_processing':
      return {
        label: 'Pre-processing',
        badgeClass: 'bg-[#EEF2FF] text-[#3730A3] border-[#C7D2FE]',
        dotClass: 'bg-[#4F46E5]',
        Icon: Layers,
      };
    case 'processing':
      return {
        label: 'Processing',
        badgeClass: 'bg-[#EFF6FF] text-[#1E40AF] border-[#93C5FD]',
        dotClass: 'bg-[#2563EB]',
        Icon: Zap,
      };
    case 'quality_assurance':
      return {
        label: 'Quality Assurance',
        badgeClass: 'bg-[#FEFCE8] text-[#854D0E] border-[#FDE047]',
        dotClass: 'bg-[#D97706]',
        Icon: ShieldCheck,
      };
    case 'completion':
      return {
        label: 'Completion',
        badgeClass: 'bg-[#F0FDF4] text-[#166534] border-[#86EFAC]',
        dotClass: 'bg-[#16A34A]',
        Icon: CheckCircle2,
      };
    default:
      return {
        label: (phase || 'Unknown').replace('_', ' '),
        badgeClass: 'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]',
        dotClass: 'bg-[#64748B]',
        Icon: Clock,
      };
  }
}

export function getStatusBadgeInfo(status?: string | null): StatusBadgeInfo {
  const normStatus = (status || 'Draft').toLowerCase();

  switch (normStatus) {
    case 'received':
      return {
        label: 'Received',
        badgeClass: 'bg-slate-100 text-slate-800 border-slate-300 shadow-2xs',
        dotClass: 'bg-slate-500',
        Icon: Inbox,
      };
    case 'for client approval':
      return {
        label: 'For Client Approval',
        badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs',
        dotClass: 'bg-indigo-500',
        Icon: UserCheck,
      };
    case 'for requirements':
      return {
        label: 'For Requirements',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 shadow-2xs',
        dotClass: 'bg-amber-500',
        Icon: ClipboardList,
      };
    case 'pending requirements':
      return {
        label: 'Pending Requirements',
        badgeClass: 'bg-orange-50 text-orange-800 border-orange-200 shadow-2xs',
        dotClass: 'bg-orange-500',
        Icon: Clock,
      };
    case 'for assignment':
      return {
        label: 'For Assignment',
        badgeClass: 'bg-violet-50 text-violet-700 border-violet-200 shadow-2xs',
        dotClass: 'bg-violet-500',
        Icon: UserPlus,
      };
    case 'in progress':
    case 'processing':
      return {
        label: 'In Progress',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 shadow-2xs',
        dotClass: 'bg-blue-500',
        Icon: Zap,
      };
    case 'for supervisor review':
      return {
        label: 'For Supervisor Review',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 shadow-2xs',
        dotClass: 'bg-purple-500',
        Icon: Eye,
      };
    case 'for billing':
    case 'billing':
      return {
        label: 'For Billing',
        badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200 shadow-2xs',
        dotClass: 'bg-cyan-500',
        Icon: DollarSign,
      };
    case 'for payment':
      return {
        label: 'For Payment',
        badgeClass: 'bg-teal-50 text-teal-700 border-teal-200 shadow-2xs',
        dotClass: 'bg-teal-500',
        Icon: CreditCard,
      };
    case 'for submission':
      return {
        label: 'For Submission',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 shadow-2xs',
        dotClass: 'bg-sky-500',
        Icon: Send,
      };
    case 'for quality check':
      return {
        label: 'For Quality Check',
        badgeClass: 'bg-yellow-50 text-yellow-800 border-yellow-200 shadow-2xs',
        dotClass: 'bg-yellow-500',
        Icon: CheckCircle,
      };
    case 'completed':
      return {
        label: 'Completed',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-2xs',
        dotClass: 'bg-emerald-500',
        Icon: CheckCircle2,
      };
    case 'pre-processing':
      return {
        label: 'Pre-processing',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 shadow-2xs',
        dotClass: 'bg-sky-500',
        Icon: Layers,
      };
    case 'for review':
      return {
        label: 'For Review',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 shadow-2xs',
        dotClass: 'bg-purple-500',
        Icon: Clock,
      };
    case 'disbursement':
      return {
        label: 'Disbursement',
        badgeClass: 'bg-violet-50 text-violet-700 border-violet-200 shadow-2xs',
        dotClass: 'bg-violet-500',
        Icon: Receipt,
      };
    case 'on hold':
      return {
        label: 'On Hold',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 shadow-2xs',
        dotClass: 'bg-amber-500',
        Icon: PauseCircle,
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 shadow-2xs',
        dotClass: 'bg-rose-500',
        Icon: Ban,
      };
    case 'draft':
    default:
      return {
        label: status || 'Draft',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 shadow-2xs',
        dotClass: 'bg-slate-400',
        Icon: FileText,
      };
  }
}
