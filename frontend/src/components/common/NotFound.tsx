import { FileQuestion, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div
      data-testid="not-found-screen"
      className="flex min-h-[500px] flex-col items-center justify-center p-8 text-center rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-card"
    >
      <div className="rounded-full bg-[#EFF6FF] p-4 text-[#1D4ED8] mb-4 border border-[#BFDBFE]">
        <FileQuestion className="h-10 w-10 text-[#1D4ED8]" />
      </div>
      <h1 className="text-4xl font-bold tracking-tight text-[#1E293B] mb-1">
        404
      </h1>
      <h2 className="text-xs font-semibold tracking-normal text-[#475569] mb-2">
        Page Not Found
      </h2>
      <p className="text-sm text-[#475569] max-w-md mb-6">
        The requested routing coordinates do not resolve to an active system module.
      </p>
      <Button asChild className="gap-2">
        <Link to="/">
          <Home className="h-4 w-4" />
          Return to Dashboard
        </Link>
      </Button>
    </div>
  );
}
