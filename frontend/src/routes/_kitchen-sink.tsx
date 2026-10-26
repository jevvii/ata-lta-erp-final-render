import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { rawCssTokens } from '@/styles/tokens';
import { Palette, CheckCircle, AlertTriangle, XCircle, Info, MoreHorizontal } from 'lucide-react';

export default function KitchenSinkPage() {
  const [selectVal, setSelectVal] = useState('Option 1');
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="space-y-10 pb-16" data-testid="kitchen-sink-page">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#1E3A8A] text-[#FFFFFF] shadow-2xs">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B]">Design System Kitchen Sink</h1>
            <p className="text-xs sm:text-sm text-[#475569]">
              Institutional Finance Ledger UI showcase rendering all 12 themed UI primitives in standard and compact densities.
            </p>
          </div>
        </div>
      </div>

      {/* 1. BUTTONS (Standard & Compact) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">1. Buttons (Standard &amp; Compact Densities)</CardTitle>
          <CardDescription>
            Interactive action triggers styled with enterprise font sizing and brand themes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              Standard Density (h-9, 14px text)
            </span>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="default">Primary (#1D4ED8)</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="destructive">Destructive (#DC2626)</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link Style</Button>
              <Button variant="ata">ATA Brand</Button>
              <Button variant="lta">LTA Brand</Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              Compact Density (h-8/h-7, 13px/12px text)
            </span>
            <div className="flex flex-wrap gap-2 items-center">
              <Button density="compact" variant="default">Primary</Button>
              <Button density="compact" variant="secondary">Secondary</Button>
              <Button density="compact" variant="outline">Outline</Button>
              <Button density="compact" variant="destructive">Destructive</Button>
              <Button density="compact" variant="ghost">Ghost</Button>
              <Button density="compact" variant="ata">ATA</Button>
              <Button density="compact" variant="lta">LTA</Button>
              <Button size="xs" variant="default">Dense XS (12px)</Button>
              <Button density="compact" disabled>Disabled</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. INPUTS (Standard & Compact) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">2. Inputs (Standard &amp; Compact Densities)</CardTitle>
          <CardDescription>Single-line form controls with active focus states.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[#1E293B] block mb-1">Standard Density (h-9)</label>
              <Input placeholder="Enter work request title..." />
            </div>
            <div>
              <label className="text-xs font-medium text-[#1E293B] block mb-1">Standard (Disabled)</label>
              <Input value="Locked invoice number #INV-2026-001" disabled />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[#1E293B] block mb-1">Compact Density (h-8, 12px)</label>
              <Input density="compact" placeholder="Filter line items..." />
            </div>
            <div>
              <label className="text-xs font-medium text-[#1E293B] block mb-1">Compact (Disabled)</label>
              <Input density="compact" value="Tax code: VAT-EXEMPT" disabled />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. SELECT (Standard & Compact) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">3. Selects (Standard &amp; Compact Densities)</CardTitle>
          <CardDescription>Custom dropdown picker built on Radix UI.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-[#1E293B] block mb-1">Standard Select</label>
            <Select value={selectVal} onValueChange={setSelectVal}>
              <SelectTrigger>
                <SelectValue placeholder="Choose entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ATA">ATA</SelectItem>
                <SelectItem value="LTA">LTA</SelectItem>
                <SelectItem value="Option 1">Consolidated (ALL)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-[#1E293B] block mb-1">Compact Select (h-8)</label>
            <Select value={selectVal} onValueChange={setSelectVal}>
              <SelectTrigger density="compact">
                <SelectValue placeholder="Choose entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ATA" density="compact">ATA</SelectItem>
                <SelectItem value="LTA" density="compact">LTA</SelectItem>
                <SelectItem value="Option 1" density="compact">ALL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 4. BADGES (Standard & Compact) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">4. Badges (Standard &amp; Compact Densities)</CardTitle>
          <CardDescription>Status indicators and corporate entity labels.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              Standard Density
            </span>
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="success">Paid / Complete</Badge>
              <Badge variant="warning">Pending Review</Badge>
              <Badge variant="info">In Progress</Badge>
              <Badge variant="ata">ATA Entity</Badge>
              <Badge variant="lta">LTA Entity</Badge>
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              Compact Density (High Density Tables)
            </span>
            <div className="flex flex-wrap gap-2">
              <Badge density="compact" variant="default">Default</Badge>
              <Badge density="compact" variant="secondary">Secondary</Badge>
              <Badge density="compact" variant="destructive">Error</Badge>
              <Badge density="compact" variant="outline">Draft</Badge>
              <Badge density="compact" variant="success">Approved</Badge>
              <Badge density="compact" variant="warning">Pending</Badge>
              <Badge density="compact" variant="info">Dispatched</Badge>
              <Badge density="compact" variant="ata">ATA</Badge>
              <Badge density="compact" variant="lta">LTA</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. CARDS (Standard & Compact) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Standard Card</CardTitle>
            <CardDescription>Default 24px padding with soft corporate drop shadow.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#1E293B]">
              Standard card content used for primary dashboard panels and configuration forms.
            </p>
          </CardContent>
          <CardFooter>
            <Button size="sm">Card Action</Button>
          </CardFooter>
        </Card>

        <Card density="compact">
          <CardHeader density="compact">
            <CardTitle density="compact">Compact Card</CardTitle>
            <CardDescription density="compact">12px padding for high-density layouts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[#1E293B]">
              Compact card content used in sidebar widgets and rapid review drawers.
            </p>
          </CardContent>
          <CardFooter density="compact">
            <Button size="xs" variant="outline">Action</Button>
          </CardFooter>
        </Card>
      </div>

      {/* 6. TABLES (Standard & High-Density) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">6. Tables (Standard &amp; High-Density Rows)</CardTitle>
          <CardDescription>Data tables formatted for accounting ledgers and operational queues.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              Standard Density Table
            </span>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-xs">WR-2026-081</TableCell>
                  <TableCell>Acme Holding Corp</TableCell>
                  <TableCell><Badge variant="ata" density="compact">ATA</Badge></TableCell>
                  <TableCell><Badge variant="success" density="compact">Completed</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">PHP 45,000.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-xs">WR-2026-082</TableCell>
                  <TableCell>Beta Logistics Inc</TableCell>
                  <TableCell><Badge variant="lta" density="compact">LTA</Badge></TableCell>
                  <TableCell><Badge variant="warning" density="compact">Pending Review</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">PHP 12,500.00</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              High-Density Table (Compact Padding, 12px row height)
            </span>
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead density="compact">Ref</TableHead>
                  <TableHead density="compact">Client</TableHead>
                  <TableHead density="compact">Entity</TableHead>
                  <TableHead density="compact">Status</TableHead>
                  <TableHead density="compact" className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell density="compact" className="">VOUCH-109</TableCell>
                  <TableCell density="compact">Delta Shipping</TableCell>
                  <TableCell density="compact"><Badge variant="ata" density="compact">ATA</Badge></TableCell>
                  <TableCell density="compact"><Badge variant="success" density="compact">Released</Badge></TableCell>
                  <TableCell density="compact" className="text-right tabular-nums">PHP 8,200.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell density="compact" className="">VOUCH-110</TableCell>
                  <TableCell density="compact">Epsilon Mining</TableCell>
                  <TableCell density="compact"><Badge variant="lta" density="compact">LTA</Badge></TableCell>
                  <TableCell density="compact"><Badge variant="info" density="compact">Draft</Badge></TableCell>
                  <TableCell density="compact" className="text-right tabular-nums">PHP 3,450.00</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 7. DIALOG & DROPDOWN MENU */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">7. Overlays: Dialog &amp; Dropdown Menu</CardTitle>
          <CardDescription>Accessible modals and context menus built on Radix UI.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-center">
          {/* Dialog */}
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="default">Open Themed Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Record Authorization</DialogTitle>
                <DialogDescription>
                  This action will authorize disbursement payment and notify Accounting.
                </DialogDescription>
              </DialogHeader>
              <div className="py-2 text-xs text-[#1E293B] space-y-1">
                <p>Payment Reference: <strong>DV-2026-0042</strong></p>
                <p>Payee: <strong>Bureau of Internal Revenue</strong></p>
                <p>Total Amount: <strong>PHP 150,000.00</strong></p>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" size="sm">Cancel</Button>
                </DialogClose>
                <Button size="sm">Confirm Authorization</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Dropdown Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <MoreHorizontal className="h-4 w-4" />
                Actions Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48">
              <DropdownMenuLabel>Record Operations</DropdownMenuLabel>
              <DropdownMenuItem>View Details</DropdownMenuItem>
              <DropdownMenuItem>Generate PDF Transmittal</DropdownMenuItem>
              <DropdownMenuItem>Duplicate Entry</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[#991B1B] focus:bg-[#FEF2F2] focus:text-[#991B1B]">
                Delete Record
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>

      {/* 8. TABS (Standard & Compact) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">8. Tabs (Standard &amp; Compact Densities)</CardTitle>
          <CardDescription>Segmented page navigation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              Standard Tabs
            </span>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="overview">All Items (142)</TabsTrigger>
                <TabsTrigger value="pending">Pending Approval (18)</TabsTrigger>
                <TabsTrigger value="completed">Completed (124)</TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                <p className="text-xs text-[#1E293B] p-3 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0]">
                  Showing all active records across assigned departments.
                </p>
              </TabsContent>
              <TabsContent value="pending">
                <p className="text-xs text-[#1E293B] p-3 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0]">
                  Showing items pending Manager review or QA verification.
                </p>
              </TabsContent>
              <TabsContent value="completed">
                <p className="text-xs text-[#1E293B] p-3 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0]">
                  Archived and released transmittals.
                </p>
              </TabsContent>
            </Tabs>
          </div>

          <div>
            <span className="text-xs font-semibold text-[#475569] tracking-normal block mb-2">
              Compact Tabs
            </span>
            <Tabs defaultValue="day">
              <TabsList density="compact">
                <TabsTrigger density="compact" value="day">Day</TabsTrigger>
                <TabsTrigger density="compact" value="week">Week</TabsTrigger>
                <TabsTrigger density="compact" value="month">Month</TabsTrigger>
                <TabsTrigger density="compact" value="year">Year</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* 9. SKELETON */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">9. Skeleton Loaders</CardTitle>
          <CardDescription>Pulsing loading placeholders for asynchronous data fetching.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center space-x-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="space-y-2 pt-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>

      {/* 10. TOAST NOTIFICATIONS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">10. Toast Feedback (Sonner)</CardTitle>
          <CardDescription>Transient status notifications matching design system colors.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="gap-2 text-[#166534]"
            onClick={() => toast.success('Operation completed successfully.')}
          >
            <CheckCircle className="h-4 w-4" />
            Success Toast
          </Button>

          <Button
            variant="outline"
            className="gap-2 text-[#854D0E]"
            onClick={() => toast.warning('Warning: Invoice draft lacks client TIN.')}
          >
            <AlertTriangle className="h-4 w-4" />
            Warning Toast
          </Button>

          <Button
            variant="outline"
            className="gap-2 text-[#DC2626]"
            onClick={() => toast.error('HTTP 409 Conflict: Record was modified by another user.')}
          >
            <XCircle className="h-4 w-4" />
            Error Toast
          </Button>

          <Button
            variant="outline"
            className="gap-2 text-[#1D4ED8]"
            onClick={() => toast.info('New notification received from dev-admin.')}
          >
            <Info className="h-4 w-4" />
            Info Toast
          </Button>
        </CardContent>
      </Card>

      {/* 11. DESIGN TOKEN EXTRACTION TABLE */}
      <Card className="border-t-2 border-t-[#1D4ED8]">
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            11. Design Token Extraction Table
          </CardTitle>
          <CardDescription>
            Two-tier primitives and semantic tokens from the Institutional Finance Ledger system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead density="compact">CSS Variable</TableHead>
                <TableHead density="compact">Extracted Value</TableHead>
                <TableHead density="compact">Preview</TableHead>
                <TableHead density="compact">Category / Usage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(rawCssTokens).map(([key, val]) => {
                const isColor = val.startsWith('#') || val.startsWith('rgba');
                return (
                  <TableRow key={key}>
                    <TableCell density="compact" className="text-xs font-semibold text-[#1E293B]">
                      {key}
                    </TableCell>
                    <TableCell density="compact" className="text-xs text-[#475569]">
                      {val}
                    </TableCell>
                    <TableCell density="compact">
                      {isColor ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-4 w-6 rounded-[4px] border border-gray-300 shadow-2xs"
                            style={{ backgroundColor: val }}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-[#475569] italic">Non-color</span>
                      )}
                    </TableCell>
                    <TableCell density="compact" className="text-xs text-[#475569]">
                      {key.includes('color-primary') || key.includes('color-accent')
                        ? 'Brand / Primary Accent'
                        : key.includes('color-ata') || key.includes('color-lta')
                        ? 'Entity Brand'
                        : key.includes('btn')
                        ? 'Button Typography'
                        : key.includes('spacing')
                        ? 'Spacing Scale'
                        : key.includes('radius')
                        ? 'Border Radius'
                        : key.includes('shadow')
                        ? 'Drop Shadow'
                        : 'Surface / Background / Status'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
