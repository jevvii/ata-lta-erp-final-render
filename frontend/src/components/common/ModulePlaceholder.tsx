import { Layers, Construction } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { isModuleEnabled } from '@/lib/flags';

interface ModulePlaceholderProps {
  name: string;
  description?: string;
}

export function ModulePlaceholder({ name, description }: ModulePlaceholderProps) {
  const enabled = isModuleEnabled(name);

  return (
    <div className="space-y-6" data-testid={`module-placeholder-${name.toLowerCase()}`}>
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-[#475569] mb-1">
            Modules / {name}
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B]">{name}</h1>
            <Badge variant={enabled ? 'success' : 'secondary'} className="text-xs">
              {enabled ? 'Active Module' : 'Phase 2 Target'}
            </Badge>
          </div>
          <p className="text-sm text-[#475569] mt-1">
            {description || `${name} management ledger and workflows for ATA & LTA ERP.`}
          </p>
        </div>
      </div>

      <Card className="border-dashed border border-[#E2E8F0] bg-[#FFFFFF] rounded-[8px] shadow-card">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto my-3 flex h-14 w-14 items-center justify-center rounded-[8px] bg-[#F8FAFC] text-[#1D4ED8] border border-[#E2E8F0]">
            {enabled ? <Layers className="h-7 w-7 text-[#1D4ED8]" /> : <Construction className="h-7 w-7 text-[#854D0E]" />}
          </div>
          <CardTitle className="text-base font-semibold tracking-tight text-[#1E293B]">
            {name} Workspace Frame
          </CardTitle>
          <CardDescription className="max-w-md mx-auto text-xs sm:text-sm text-[#475569]">
            {enabled
              ? 'This module is enabled in feature flags and ready for Phase 2 implementation.'
              : 'This module is gated by Phase 1 enterprise architecture rules. Business workflows and operations will be integrated in Phase 2.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-xs text-[#475569] pt-2 pb-6">
          <div className="inline-flex items-center gap-2 rounded-[6px] bg-[#F8FAFC] px-3.5 py-1.5 border border-[#E2E8F0] text-xs text-[#334155]">
            <span className="h-2 w-2 rounded-full bg-[#1D4ED8]" />
            <span>React 19 &bull; TS 5.7 &bull; Vite 6 &bull; TanStack Query 5</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
