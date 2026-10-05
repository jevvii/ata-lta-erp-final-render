import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Building2, User, CreditCard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateClient, useUpdateClient } from '../api/useClients';
import { useSessionStore } from '@/lib/session';
import type { Client, ContactDetailType } from '../api/types';

export interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  client?: Client | null; // If passed, edit mode; if null/undefined, create mode
  onSuccess?: () => void;
}

interface ContactRow {
  type: ContactDetailType;
  value: string;
  label: string;
}

interface RelatedCompanyRow {
  relatedClientId: string;
  relationship: string;
}

export function ClientModal({
  isOpen,
  onClose,
  client,
  onSuccess,
}: ClientModalProps) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const defaultEntity: 'ATA' | 'LTA' = activeEntity === 'LTA' ? 'LTA' : 'ATA';

  const { createWithBlocking } = useCreateClient();
  const { updateWithBlocking } = useUpdateClient();

  const isEditing = Boolean(client);

  // Form Fields
  const [name, setName] = useState('');
  const [tin, setTin] = useState('');
  const [rdoCode, setRdoCode] = useState('');
  const [address, setAddress] = useState('');
  const [entity, setEntity] = useState<'ATA' | 'LTA'>(defaultEntity);
  const [tradeName, setTradeName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [retainer, setRetainer] = useState(false);
  const [retainerFee, setRetainerFee] = useState<string>('');

  // Dynamic rows
  const [contactDetails, setContactDetails] = useState<ContactRow[]>([]);
  const [relatedCompanies, setRelatedCompanies] = useState<RelatedCompanyRow[]>([]);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (client) {
      setName(client.name || '');
      setTin(client.tin || '');
      setRdoCode(client.rdoCode || '');
      setAddress(client.address || '');
      setEntity(client.entity === 'LTA' ? 'LTA' : 'ATA');
      setTradeName(client.tradeName || '');
      setContactPerson(client.contactPerson || '');
      setRetainer(client.retainer || false);
      setRetainerFee(client.retainerFee !== null && client.retainerFee !== undefined ? String(client.retainerFee) : '');
      setContactDetails(
        (client.contactDetails || []).map((cd) => ({
          type: cd.type,
          value: cd.value,
          label: cd.label || '',
        }))
      );
      setRelatedCompanies(
        (client.relatedCompanies || []).map((rc) => ({
          relatedClientId: rc.relatedClientId,
          relationship: rc.relationship || '',
        }))
      );
    } else {
      setName('');
      setTin('');
      setRdoCode('');
      setAddress('');
      setEntity(defaultEntity);
      setTradeName('');
      setContactPerson('');
      setRetainer(false);
      setRetainerFee('');
      setContactDetails([]);
      setRelatedCompanies([]);
    }
    setErrors({});
  }, [client, isOpen, defaultEntity]);

  const handleAddContact = () => {
    setContactDetails((prev) => [
      ...prev,
      { type: 'email', value: '', label: '' },
    ]);
  };

  const handleRemoveContact = (index: number) => {
    setContactDetails((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContactChange = (index: number, field: keyof ContactRow, val: string) => {
    setContactDetails((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: val } : c))
    );
  };

  const handleAddRelatedCompany = () => {
    setRelatedCompanies((prev) => [
      ...prev,
      { relatedClientId: '', relationship: '' },
    ]);
  };

  const handleRemoveRelatedCompany = (index: number) => {
    setRelatedCompanies((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRelatedCompanyChange = (index: number, field: keyof RelatedCompanyRow, val: string) => {
    setRelatedCompanies((prev) =>
      prev.map((rc, i) => (i === index ? { ...rc, [field]: val } : rc))
    );
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Client name is required';
    if (!tin.trim()) newErrors.tin = 'TIN is required';
    if (retainer && retainerFee) {
      const num = Number(retainerFee);
      if (isNaN(num) || num < 0) newErrors.retainerFee = 'Retainer fee must be a valid positive amount';
    }

    // Validate contacts
    contactDetails.forEach((cd, idx) => {
      if (!cd.value.trim()) {
        newErrors[`contact_${idx}`] = 'Contact value cannot be blank';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const payload = {
      name: name.trim(),
      tin: tin.trim(),
      rdoCode: rdoCode.trim() || undefined,
      address: address.trim() || undefined,
      entity,
      tradeName: tradeName.trim() || undefined,
      contactPerson: contactPerson.trim() || undefined,
      retainer,
      retainerFee: retainer && retainerFee.trim() ? Number(retainerFee) : null,
      contactDetails: contactDetails.map((cd) => ({
        type: cd.type,
        value: cd.value.trim(),
        label: cd.label.trim() || undefined,
      })),
      relatedCompanies: relatedCompanies.map((rc) => ({
        relatedClientId: rc.relatedClientId.trim(),
        relationship: rc.relationship.trim() || undefined,
      })),
    };

    try {
      if (isEditing && client) {
        await updateWithBlocking(client.id, {
          ...payload,
          expectedVersion: client.version,
        });
      } else {
        await createWithBlocking(payload);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch {
      // Handled and presented by BlockingActionModal
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5"
        data-testid="client-modal"
      >
        <DialogHeader className="border-b border-slate-100 pb-3">
          <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <span data-testid="client-modal-title">
              {isEditing ? `Edit Client: ${client?.name}` : 'Register New Client'}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {isEditing
              ? 'Modify client master record, tax identification, and contact information.'
              : 'Add a new client record to the master corporate directory.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4" data-testid="client-form">
          {/* Section 1: Basic Corporate & Tax Information */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              General & Tax Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Client Name */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700">
                  Client Registered Name <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Acme Corporation or Juan Dela Cruz"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                  }}
                  className={`text-xs h-9 ${errors.name ? 'border-red-500' : ''}`}
                  data-testid="client-input-name"
                  required
                />
                {errors.name && (
                  <p className="text-[11px] text-red-500" data-testid="error-client-name">
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Trade Name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Trade Name / DBA (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Acme Stores"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  className="text-xs h-9"
                  data-testid="client-input-trade-name"
                />
              </div>

              {/* Entity */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Entity <span className="text-red-500">*</span>
                </label>
                <Select
                  value={entity}
                  onValueChange={(val: 'ATA' | 'LTA') => setEntity(val)}
                  disabled={isEditing}
                >
                  <SelectTrigger className="text-xs h-9" data-testid="client-select-entity">
                    <SelectValue placeholder="Select Entity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ATA">ATA (Albay Tax & Accounting)</SelectItem>
                    <SelectItem value="LTA">LTA (LTA Business Management)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* TIN */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Tax Identification Number (TIN) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="000-000-000-000"
                  value={tin}
                  onChange={(e) => {
                    setTin(e.target.value);
                    if (errors.tin) setErrors((prev) => ({ ...prev, tin: '' }));
                  }}
                  className={`text-xs h-9 font-mono ${errors.tin ? 'border-red-500' : ''}`}
                  data-testid="client-input-tin"
                  required
                />
                {errors.tin && (
                  <p className="text-[11px] text-red-500" data-testid="error-client-tin">
                    {errors.tin}
                  </p>
                )}
              </div>

              {/* RDO Code */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Revenue District Office (RDO)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 044, 047"
                  value={rdoCode}
                  onChange={(e) => setRdoCode(e.target.value)}
                  className="text-xs h-9 font-mono"
                  data-testid="client-input-rdo"
                />
              </div>

              {/* Registered Address */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700">
                  Official Registered Address
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Unit 123 Tower Building, Ayala Ave, Makati City"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="text-xs h-9"
                  data-testid="client-input-address"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Retainer Agreement */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />
              Retainer Agreement
            </h4>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retainer}
                  onChange={(e) => setRetainer(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  data-testid="client-checkbox-retainer"
                />
                <span className="text-xs font-medium text-slate-800">
                  This client maintains an active monthly retainer agreement
                </span>
              </label>

              {retainer && (
                <div className="space-y-1 max-w-xs pt-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Monthly Retainer Fee (PHP)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={retainerFee}
                    onChange={(e) => setRetainerFee(e.target.value)}
                    className="text-xs h-9 font-mono"
                    data-testid="client-input-retainer-fee"
                  />
                  {errors.retainerFee && (
                    <p className="text-[11px] text-red-500">{errors.retainerFee}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Contact Person & Details */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Contact Information
              </h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddContact}
                className="text-xs h-7 gap-1"
                data-testid="client-add-contact-btn"
              >
                <Plus className="h-3 w-3" />
                Add Channel
              </Button>
            </div>

            <div className="space-y-2">
              <div className="space-y-1 max-w-sm">
                <label className="text-xs font-semibold text-slate-700">
                  Primary Contact Person
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Maria Santos (Chief Accountant)"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="text-xs h-9"
                  data-testid="client-input-contact-person"
                />
              </div>

              {/* Dynamic contact rows */}
              {contactDetails.map((cd, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  data-testid={`contact-row-${index}`}
                >
                  <div className="w-28 shrink-0">
                    <Select
                      value={cd.type}
                      onValueChange={(val: ContactDetailType) =>
                        handleContactChange(index, 'type', val)
                      }
                    >
                      <SelectTrigger className="text-xs h-8 bg-white" data-testid={`contact-type-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="mobile">Mobile</SelectItem>
                        <SelectItem value="phone">Phone</SelectItem>
                        <SelectItem value="landline">Landline</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Input
                    type="text"
                    placeholder="e.g. client@company.com"
                    value={cd.value}
                    onChange={(e) => handleContactChange(index, 'value', e.target.value)}
                    className="text-xs h-8 flex-1 bg-white"
                    data-testid={`contact-value-${index}`}
                  />

                  <Input
                    type="text"
                    placeholder="Label (e.g. Finance)"
                    value={cd.label}
                    onChange={(e) => handleContactChange(index, 'label', e.target.value)}
                    className="text-xs h-8 w-28 bg-white"
                    data-testid={`contact-label-${index}`}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveContact(index)}
                    className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                    data-testid={`contact-remove-btn-${index}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Related Companies */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Related Companies & Affiliates
              </h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddRelatedCompany}
                className="text-xs h-7 gap-1"
                data-testid="client-add-related-btn"
              >
                <Plus className="h-3 w-3" />
                Add Affiliate
              </Button>
            </div>

            {relatedCompanies.map((rc, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                data-testid={`related-row-${index}`}
              >
                <Input
                  type="text"
                  placeholder="Related Client UUID"
                  value={rc.relatedClientId}
                  onChange={(e) =>
                    handleRelatedCompanyChange(index, 'relatedClientId', e.target.value)
                  }
                  className="text-xs h-8 flex-1 font-mono bg-white"
                  data-testid={`related-client-id-${index}`}
                />
                <Input
                  type="text"
                  placeholder="Relationship (e.g. Subsidiary)"
                  value={rc.relationship}
                  onChange={(e) =>
                    handleRelatedCompanyChange(index, 'relationship', e.target.value)
                  }
                  className="text-xs h-8 w-44 bg-white"
                  data-testid={`related-relationship-${index}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveRelatedCompany(index)}
                  className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  data-testid={`related-remove-btn-${index}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="client-submit-btn"
            >
              {isEditing ? 'Save Modifications' : 'Create Client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
