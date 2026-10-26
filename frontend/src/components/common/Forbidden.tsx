import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface ForbiddenProps {
  requiredPermission?: string;
}

export function Forbidden({ requiredPermission }: ForbiddenProps) {
  return (
    <div
      data-testid="forbidden-screen"
      className="flex min-h-[500px] flex-col items-center justify-center p-8 text-center rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-card"
    >
      <div className="rounded-full bg-[#FEFCE8] p-4 text-[#854D0E] mb-4 border border-[#FDE047]">
        <ShieldAlert className="h-10 w-10 text-[#854D0E]" />
      </div>
      <div className="mb-2 inline-block rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 text-xs font-medium text-[#334155]">
        403 Forbidden
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] mb-2">
        Access Forbidden
      </h1>
      <p className="text-sm text-[#475569] max-w-md mb-2">
        You do not have the necessary operational permissions to access this ledger division.
      </p>
      {requiredPermission && (
        <div className="my-2 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-1.5 text-xs text-[#334155]">
          Required Permission: <span className="font-semibold text-[#DC2626]">{requiredPermission}</span>
        </div>
      )}
      <div className="mt-6">
        <Button asChild variant="outline" className="gap-2">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Return to Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
