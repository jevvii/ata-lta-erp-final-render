import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Building2, User, CreditCard, Link as LinkIcon } from 'lucide-react';
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
import {
  useCreateClient,
  useUpdateClient,
  useClientsList,
  useRegisteredUsers,
} from '../api/useClients';
import { useSessionStore } from '@/lib/session';
import {
  formatTin,
  formatRdoCode,
  formatContactValue,
  getContactPlaceholder,
  getContactMaxLength,
} from '../lib/formatters';
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

  // Queries for registered users (Point of Contact) and existing clients (Affiliates)
  const { data: registeredUsers = [] } = useRegisteredUsers();
  const { data: clientsData } = useClientsList({ limit: 100 });
  const allClients = clientsData?.data || [];
  const availableClients = allClients.filter((c) => c.id !== client?.id);

  const isEditing = Boolean(client);

  // Form Fields
  const [name, setName] = useState('');
  const [tin, setTin] = useState('');
  const [rdoCode, setRdoCode] = useState('');
  const [address, setAddress] = useState('');
  const [entity, setEntity] = useState<'ATA' | 'LTA'>(defaultEntity);
  const [tradeName, setTradeName] = useState('');
  const [contactUserId, setContactUserId] = useState<string>('');
  const [contactPerson, setContactPerson] = useState<string>('');
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
      setTin(client.tin ? formatTin(client.tin) : '');
      setRdoCode(client.rdoCode ? formatRdoCode(client.rdoCode) : '');
      setAddress(client.address || '');
      setEntity(client.entity === 'LTA' ? 'LTA' : 'ATA');
      setTradeName(client.tradeName || '');
      setContactUserId(client.contactUserId || '');
      setContactPerson(client.contactPerson || '');
      setRetainer(client.retainer || false);
      setRetainerFee(
        client.retainerFee !== null && client.retainerFee !== undefined
          ? String(client.retainerFee)
          : ''
      );
      setContactDetails(
        (client.contactDetails || []).map((cd) => ({
          type: cd.type,
          value: cd.value ? formatContactValue(cd.type, cd.value) : '',
          label: cd.label || '',
        }))
      );
      setRelatedCompanies(
        (client.relatedCompanies || []).map((rc) => ({
          relatedClientId: rc.relatedClientId || '',
          relationship: rc.relationship || 'Affiliate',
        }))
      );
    } else {
      setName('');
      setTin('');
      setRdoCode('');
      setAddress('');
      setEntity(defaultEntity);
      setTradeName('');
      setContactUserId('');
      setContactPerson('');
      setRetainer(false);
      setRetainerFee('');
      setContactDetails([]);
      setRelatedCompanies([]);
    }
    setErrors({});
  }, [client, isOpen, defaultEntity]);

  // Point of Contact Selection Handler
  const handlePocChange = (val: string) => {
    if (val === 'none') {
      setContactUserId('');
      setContactPerson('');
    } else if (val.startsWith('custom:')) {
      setContactUserId('');
      setContactPerson(val.replace('custom:', '').trim());
    } else {
      setContactUserId(val);
      const matched = registeredUsers.find((u) => u.id === val);
      if (matched) {
        setContactPerson(matched.name);
      }
    }
  };

  const handleAddContact = () => {
    setContactDetails((prev) => [
      ...prev,
      { type: 'mobile', value: '', label: '' },
    ]);
  };

  const handleRemoveContact = (index: number) => {
    setContactDetails((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const updated = { ...prev };
      delete updated[`contact_${index}`];
      return updated;
    });
  };

  const handleContactTypeChange = (index: number, newType: ContactDetailType) => {
    setContactDetails((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c;
        const reFormatted = formatContactValue(newType, c.value);
        return { ...c, type: newType, value: reFormatted };
      })
    );
    if (errors[`contact_${index}`]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[`contact_${index}`];
        return updated;
      });
    }
  };

  const handleContactValueChange = (index: number, rawVal: string) => {
    const currentType = contactDetails[index]?.type || 'mobile';
    const formattedVal = formatContactValue(currentType, rawVal);
    setContactDetails((prev) =>
      prev.map((c, i) => (i === index ? { ...c, value: formattedVal } : c))
    );
    if (errors[`contact_${index}`]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[`contact_${index}`];
        return updated;
      });
    }
  };

  const handleContactLabelChange = (index: number, labelVal: string) => {
    setContactDetails((prev) =>
      prev.map((c, i) => (i === index ? { ...c, label: labelVal.slice(0, 50) } : c))
    );
  };

  const handleAddRelatedCompany = () => {
    setRelatedCompanies((prev) => [
      ...prev,
      { relatedClientId: '', relationship: 'Affiliate' },
    ]);
  };

  const handleRemoveRelatedCompany = (index: number) => {
    setRelatedCompanies((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const updated = { ...prev };
      delete updated[`related_${index}`];
      return updated;
    });
  };

  const handleRelatedCompanyChange = (
    index: number,
    field: keyof RelatedCompanyRow,
    val: string
  ) => {
    setRelatedCompanies((prev) =>
      prev.map((rc, i) => (i === index ? { ...rc, [field]: val } : rc))
    );
    if (errors[`related_${index}`]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[`related_${index}`];
        return updated;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // 1. Client Registered Name
    if (!name.trim()) {
      newErrors.name = 'Client registered name is required';
    } else if (name.trim().length > 255) {
      newErrors.name = 'Client name cannot exceed 255 characters';
    }

    // 2. TIN validation
    if (!tin.trim()) {
      newErrors.tin = 'TIN is required';
    } else {
      const digitsOnly = tin.replace(/\D/g, '');
      if (digitsOnly.length < 9) {
        newErrors.tin = 'TIN must contain at least 9 digits (format: 000-000-000-00000)';
      } else if (!/^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/.test(tin.trim())) {
        newErrors.tin = 'TIN must be in format 000-000-000-00000 (or 000-000-000-000)';
      }
    }

    // 3. RDO Code validation (optional, 3-4 alphanumeric characters)
    if (rdoCode.trim() && !/^[A-Z0-9]{3,4}$/.test(rdoCode.trim())) {
      newErrors.rdoCode = 'RDO Code must be 3 or 4 alphanumeric characters (e.g. 044, 034A)';
    }

    // 4. Trade Name length guard
    if (tradeName.trim().length > 255) {
      newErrors.tradeName = 'Trade name cannot exceed 255 characters';
    }

    // 5. Address length guard
    if (address.trim().length > 500) {
      newErrors.address = 'Official address cannot exceed 500 characters';
    }

    // 6. Retainer Fee validation
    if (retainer) {
      if (!retainerFee.trim()) {
        newErrors.retainerFee = 'Monthly retainer fee is required when retainer agreement is active';
      } else {
        const num = Number(retainerFee);
        if (isNaN(num) || num < 0) {
          newErrors.retainerFee = 'Retainer fee must be a valid non-negative amount';
        }
      }
    }

    // 7. Contact Details validation
    contactDetails.forEach((cd, idx) => {
      const val = cd.value.trim();
      if (!val) {
        newErrors[`contact_${idx}`] = 'Contact value cannot be blank';
      } else if (cd.type === 'mobile') {
        if (!/^\d{11}$/.test(val)) {
          newErrors[`contact_${idx}`] = 'Mobile number must be exactly 11 digits (e.g. 09123456789)';
        }
      } else if (cd.type === 'landline' || cd.type === 'phone') {
        if (!/^\d{7,10}$/.test(val)) {
          newErrors[`contact_${idx}`] = 'Landline/phone must be 7 to 10 digits';
        }
      } else if (cd.type === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          newErrors[`contact_${idx}`] = 'Please enter a valid email address';
        }
      }
    });

    // 8. Related Companies validation
    const seenRelatedIds = new Set<string>();
    relatedCompanies.forEach((rc, idx) => {
      const targetId = rc.relatedClientId.trim();
      if (!targetId) {
        newErrors[`related_${idx}`] = 'Please select a related company or remove this row';
      } else if (client && targetId === client.id) {
        newErrors[`related_${idx}`] = 'A client cannot be a related company of itself';
      } else if (seenRelatedIds.has(targetId)) {
        newErrors[`related_${idx}`] = 'This company has already been added as a related affiliate';
      } else {
        seenRelatedIds.add(targetId);
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    // Sanitize and filter out empty items before submission
    const sanitizedContactDetails = contactDetails
      .filter((cd) => cd.value.trim().length > 0)
      .map((cd) => ({
        type: cd.type,
        value: cd.value.trim(),
        label: cd.label.trim() || undefined,
      }));

    const sanitizedRelatedCompanies = relatedCompanies
      .filter((rc) => rc.relatedClientId && rc.relatedClientId.trim().length > 0)
      .map((rc) => ({
        relatedClientId: rc.relatedClientId.trim(),
        relationship: rc.relationship.trim() || 'Affiliate',
      }));

    const payload = {
      name: name.trim(),
      tin: tin.trim(),
      rdoCode: rdoCode.trim() || undefined,
      address: address.trim() || undefined,
      entity,
      tradeName: tradeName.trim() || undefined,
      contactUserId: contactUserId.trim() || null,
      contactPerson: contactPerson.trim() || null,
      retainer,
      retainerFee: retainer && retainerFee.trim() ? Number(retainerFee) : null,
      contactDetails: sanitizedContactDetails,
      relatedCompanies: sanitizedRelatedCompanies,
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

  // Track already selected related clients across other rows to prevent duplicate selections
  const getSelectedOtherClientIds = (currentIndex: number) => {
    return new Set(
      relatedCompanies
        .filter((_, i) => i !== currentIndex)
        .map((r) => r.relatedClientId)
        .filter(Boolean)
    );
  };

  // Selected value for Point of Contact dropdown
  const currentPocSelectValue =
    contactUserId ||
    (contactPerson ? `custom:${contactPerson}` : 'none');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5 rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float"
        data-testid="client-modal"
      >
        <DialogHeader className="border-b border-[#E2E8F0] pb-3">
          <DialogTitle className="text-base font-semibold uppercase tracking-tight text-[#1E293B] flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#1D4ED8]" />
            <span data-testid="client-modal-title">
              {isEditing ? `Edit Client: ${client?.name}` : 'Register New Client'}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            {isEditing
              ? 'Modify client master record, tax identification, and contact information.'
              : 'Add a new client record to the master corporate directory.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4" data-testid="client-form">
          {/* Section 1: Basic Corporate & Tax Information */}
          <div className="space-y-3">
            <h4 className="text-xs tabular-nums font-bold text-[#1E293B] tracking-normal">
              General & Tax Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Client Name */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs tracking-normal font-bold text-[#1E293B]">
                  Client Registered Name <span className="text-[#DC2626]">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Acme Corporation or Juan Dela Cruz"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                  }}
                  className={`text-xs h-9  rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] ${errors.name ? 'border-[#FCA5A5]' : ''}`}
                  data-testid="client-input-name"
                  required
                />
                {errors.name && (
                  <p className="text-xs text-[#DC2626]" data-testid="error-client-name">
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Trade Name */}
              <div className="space-y-1">
                <label className="text-xs tracking-normal font-bold text-[#1E293B]">
                  Trade Name / DBA (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Acme Stores"
                  value={tradeName}
                  onChange={(e) => {
                    setTradeName(e.target.value);
                    if (errors.tradeName) setErrors((prev) => ({ ...prev, tradeName: '' }));
                  }}
                  className={`text-xs h-9  rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] ${errors.tradeName ? 'border-[#FCA5A5]' : ''}`}
                  data-testid="client-input-trade-name"
                />
                {errors.tradeName && (
                  <p className="text-xs text-[#DC2626]" data-testid="error-client-trade-name">
                    {errors.tradeName}
                  </p>
                )}
              </div>

              {/* Entity */}
              <div className="space-y-1">
                <label className="text-xs tracking-normal font-bold text-[#1E293B]">
                  Entity <span className="text-[#DC2626]">*</span>
                </label>
                <Select
                  value={entity}
                  onValueChange={(val: 'ATA' | 'LTA') => setEntity(val)}
                  disabled={isEditing}
                >
                  <SelectTrigger className="text-xs h-9 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B]" data-testid="client-select-entity">
                    <SelectValue placeholder="Select Entity" />
                  </SelectTrigger>
                  <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                    <SelectItem value="ATA" className="text-xs font-bold">ATA</SelectItem>
                    <SelectItem value="LTA" className="text-xs font-bold">LTA</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* TIN */}
              <div className="space-y-1">
                <label className="text-xs tracking-normal font-bold text-[#1E293B]">
                  Tax Identification Number (TIN) <span className="text-[#DC2626]">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="000-000-000-00000"
                  maxLength={17}
                  value={tin}
                  onChange={(e) => {
                    const formatted = formatTin(e.target.value, tin);
                    setTin(formatted);
                    if (errors.tin) setErrors((prev) => ({ ...prev, tin: '' }));
                  }}
                  className={`text-xs h-9 font-mono rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] tabular-nums ${errors.tin ? 'border-[#FCA5A5]' : ''}`}
                  data-testid="client-input-tin"
                  required
                />
                {errors.tin && (
                  <p className="text-xs text-[#DC2626]" data-testid="error-client-tin">
                    {errors.tin}
                  </p>
                )}
              </div>

              {/* RDO Code */}
              <div className="space-y-1">
                <label className="text-xs tracking-normal font-bold text-[#1E293B]">
                  Revenue District Office (RDO)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 044, 034A"
                  maxLength={4}
                  value={rdoCode}
                  onChange={(e) => {
                    const formatted = formatRdoCode(e.target.value);
                    setRdoCode(formatted);
                    if (errors.rdoCode) setErrors((prev) => ({ ...prev, rdoCode: '' }));
                  }}
                  className={`text-xs h-9  rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] ${errors.rdoCode ? 'border-[#FCA5A5]' : ''}`}
                  data-testid="client-input-rdo"
                />
                {errors.rdoCode && (
                  <p className="text-xs text-[#DC2626]" data-testid="error-client-rdo">
                    {errors.rdoCode}
                  </p>
                )}
              </div>

              {/* Registered Address */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs tracking-normal font-bold text-[#1E293B]">
                  Official Registered Address
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Unit 123 Tower Building, Ayala Ave, Makati City"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    if (errors.address) setErrors((prev) => ({ ...prev, address: '' }));
                  }}
                  className={`text-xs h-9  rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] ${errors.address ? 'border-[#FCA5A5]' : ''}`}
                  data-testid="client-input-address"
                />
                {errors.address && (
                  <p className="text-xs text-[#DC2626]" data-testid="error-client-address">
                    {errors.address}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Retainer Agreement */}
          <div className="space-y-3 pt-2 border-t border-[#E2E8F0]">
            <h4 className="text-xs font-bold text-[#1E293B] tracking-normal flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5 text-[#1E293B]" />
              Retainer Agreement
            </h4>
            <div className="p-3 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retainer}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRetainer(checked);
                    if (!checked) setRetainerFee('');
                    if (errors.retainerFee) setErrors((prev) => ({ ...prev, retainerFee: '' }));
                  }}
                  className="h-4 w-4 rounded-[8px] border-[#E2E8F0] text-[#1E293B] focus:ring-0"
                  data-testid="client-checkbox-retainer"
                />
                <span className="text-xs font-medium text-[#1E293B]">
                  This client maintains an active monthly retainer agreement
                </span>
              </label>

              {retainer && (
                <div className="space-y-1 max-w-xs pt-1">
                  <label className="text-xs tabular-nums tracking-normal font-bold text-[#1E293B]">
                    Monthly Retainer Fee (PHP) <span className="text-[#DC2626]">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={retainerFee}
                    onChange={(e) => {
                      setRetainerFee(e.target.value);
                      if (errors.retainerFee) setErrors((prev) => ({ ...prev, retainerFee: '' }));
                    }}
                    className={`text-xs h-9  rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] tabular-nums ${errors.retainerFee ? 'border-[#FCA5A5]' : ''}`}
                    data-testid="client-input-retainer-fee"
                  />
                  {errors.retainerFee && (
                    <p className="text-xs text-[#DC2626]" data-testid="error-client-retainer-fee">
                      {errors.retainerFee}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Point of Contact & Contact Channels */}
          <div className="space-y-3 pt-2 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#1E293B] tracking-normal flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-[#1E293B]" />
                Contact Information
              </h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddContact}
                className="text-xs tracking-normal h-7 gap-1 rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#1E293B]"
                data-testid="client-add-contact-btn"
              >
                <Plus className="h-3 w-3" />
                Add Channel
              </Button>
            </div>

            <div className="space-y-3">
              {/* Point of Contact Dropdown (showing registered users) */}
              <div className="space-y-1 max-w-sm">
                <label className="text-xs tracking-normal font-bold text-[#1E293B] flex items-center gap-1.5">
                  Point of Contact
                </label>
                <Select
                  value={currentPocSelectValue}
                  onValueChange={handlePocChange}
                >
                  <SelectTrigger className="text-xs h-9 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B]" data-testid="client-select-poc">
                    <SelectValue placeholder="-- Select Point of Contact --" />
                  </SelectTrigger>
                  <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                    <SelectItem value="none" className="text-xs">-- Select Point of Contact --</SelectItem>
                    {registeredUsers.map((u) => (
                      <SelectItem
                        key={u.id}
                        value={u.id}
                        className="text-xs"
                        data-testid={`poc-user-${u.id}`}
                      >
                        {u.name} {u.role ? `(${u.role})` : u.email ? `(${u.email})` : ''}
                      </SelectItem>
                    ))}
                    {client &&
                      client.contactPerson &&
                      !contactUserId &&
                      !registeredUsers.some((u) => u.name === client.contactPerson) && (
                        <SelectItem
                          value={`custom:${client.contactPerson}`}
                          className="text-xs"
                          data-testid="poc-user-custom"
                        >
                          {client.contactPerson} (Custom)
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
                <p className="text-xs tabular-nums text-[#475569]">
                  Select an internal user account as the firm representative for this client.
                </p>
              </div>

              {/* Dynamic contact rows */}
              {contactDetails.map((cd, index) => (
                <div key={index} className="space-y-1">
                  <div
                    className="flex items-center gap-2 p-2 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-xs"
                    data-testid={`contact-row-${index}`}
                  >
                    <div className="w-28 shrink-0">
                      <Select
                        value={cd.type}
                        onValueChange={(val: ContactDetailType) =>
                          handleContactTypeChange(index, val)
                        }
                      >
                        <SelectTrigger className="text-xs h-8 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B]" data-testid={`contact-type-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                          <SelectItem value="mobile" className="text-xs">Mobile</SelectItem>
                          <SelectItem value="email" className="text-xs">Email</SelectItem>
                          <SelectItem value="phone" className="text-xs">Phone</SelectItem>
                          <SelectItem value="landline" className="text-xs">Landline</SelectItem>
                          <SelectItem value="other" className="text-xs">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Input
                      type="text"
                      placeholder={getContactPlaceholder(cd.type)}
                      maxLength={getContactMaxLength(cd.type)}
                      value={cd.value}
                      onChange={(e) => handleContactValueChange(index, e.target.value)}
                      className={`text-xs h-8 flex-1  rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] ${
                        errors[`contact_${index}`] ? 'border-[#FCA5A5]' : ''
                      }`}
                      data-testid={`contact-value-${index}`}
                    />

                    <Input
                      type="text"
                      placeholder="Label (e.g. Finance)"
                      value={cd.label}
                      onChange={(e) => handleContactLabelChange(index, e.target.value)}
                      className="text-xs h-8 w-28 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B]"
                      data-testid={`contact-label-${index}`}
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveContact(index)}
                      className="h-8 w-8 p-0 rounded-[6px] text-[#1E293B] hover:text-[#DC2626] hover:bg-transparent shrink-0"
                      data-testid={`contact-remove-btn-${index}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {errors[`contact_${index}`] && (
                    <p className="text-xs text-[#DC2626] pl-1" data-testid={`error-contact-${index}`}>
                      {errors[`contact_${index}`]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Related Companies & Affiliates */}
          <div className="space-y-3 pt-2 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-[#1E293B] tracking-normal flex items-center gap-1.5">
                  <LinkIcon className="h-3.5 w-3.5 text-[#1E293B]" />
                  Related Companies & Affiliates
                </h4>
                <p className="text-xs tabular-nums text-[#475569]">
                  Select registered clients from the master corporate directory.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddRelatedCompany}
                className="text-xs tracking-normal h-7 gap-1 rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#1E293B]"
                data-testid="client-add-related-btn"
              >
                <Plus className="h-3 w-3" />
                Add Affiliate
              </Button>
            </div>

            {relatedCompanies.map((rc, index) => {
              const selectedOtherIds = getSelectedOtherClientIds(index);

              return (
                <div key={index} className="space-y-1">
                  <div
                    className="flex items-center gap-2 p-2 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-xs"
                    data-testid={`related-row-${index}`}
                  >
                    {/* Client Dropdown */}
                    <div className="flex-1 min-w-[160px]">
                      <Select
                        value={rc.relatedClientId}
                        onValueChange={(val) =>
                          handleRelatedCompanyChange(index, 'relatedClientId', val)
                        }
                      >
                        <SelectTrigger
                          className={`text-xs  h-8 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] ${
                            errors[`related_${index}`] ? 'border-[#FCA5A5]' : ''
                          }`}
                          data-testid={`related-client-id-${index}`}
                        >
                          <SelectValue placeholder="— Select Client —" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                          {availableClients.length === 0 ? (
                            <SelectItem value="none" disabled className="text-xs">
                              No other clients available
                            </SelectItem>
                          ) : (
                            availableClients.map((c) => (
                              <SelectItem
                                key={c.id}
                                value={c.id}
                                disabled={selectedOtherIds.has(c.id)}
                                className="text-xs"
                                data-testid={`related-client-option-${c.id}`}
                              >
                                {c.name} {c.entity ? `(${c.entity})` : ''}
                              </SelectItem>
                            ))
                          )}
                          {/* If rc.relatedClientId is set but not in availableClients, keep it visible */}
                          {rc.relatedClientId &&
                            !availableClients.some((c) => c.id === rc.relatedClientId) && (
                              <SelectItem
                                key={rc.relatedClientId}
                                value={rc.relatedClientId}
                                className="text-xs"
                              >
                                Client ID: {rc.relatedClientId}
                              </SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Relationship Dropdown */}
                    <div className="w-40 shrink-0">
                      <Select
                        value={rc.relationship || 'Affiliate'}
                        onValueChange={(val) =>
                          handleRelatedCompanyChange(index, 'relationship', val)
                        }
                      >
                        <SelectTrigger
                          className="text-xs h-8 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B]"
                          data-testid={`related-relationship-${index}`}
                        >
                          <SelectValue placeholder="Relationship" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                          <SelectItem value="Parent" className="text-xs">Parent</SelectItem>
                          <SelectItem value="Subsidiary" className="text-xs">Subsidiary</SelectItem>
                          <SelectItem value="Sister Company" className="text-xs">Sister Company</SelectItem>
                          <SelectItem value="Affiliate" className="text-xs">Affiliate</SelectItem>
                          <SelectItem value="Branch" className="text-xs">Branch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveRelatedCompany(index)}
                      className="h-8 w-8 p-0 rounded-[6px] text-[#1E293B] hover:text-[#DC2626] hover:bg-transparent shrink-0"
                      data-testid={`related-remove-btn-${index}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {errors[`related_${index}`] && (
                    <p className="text-xs text-[#DC2626] pl-1" data-testid={`error-related-${index}`}>
                      {errors[`related_${index}`]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              className="text-xs tracking-normal font-bold rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
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
