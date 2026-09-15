/**
 * User Profile page.
 * Allows viewing details, updating name/avatar, changing password,
 * and setting preferences (theme, default filter view).
 * Styled to strictly match target design while preserving the system theme scheme.
 */

const Profile = {
  render() {
    const container = el('div', { class: 'page profile-page' });

    const titleBar = el('div', { class: 'profile-header' });
    titleBar.appendChild(el('h1', { class: 'page-title-h1', text: 'Profile' }));
    titleBar.appendChild(el('p', { class: 'page-subtitle', text: 'Manage your account information and preferences.' }));
    container.appendChild(titleBar);

    const grid = el('div', { class: 'profile-grid' });
    container.appendChild(grid);

    // Initial render with loading loaders
    const detailsCard = this.renderDetailsCard(true);
    const passwordCard = this.renderPasswordCard(true);
    const preferencesCard = this.renderPreferencesCard(true);

    grid.appendChild(detailsCard);
    grid.appendChild(passwordCard);
    grid.appendChild(preferencesCard);

    // Show Google loaders on cards immediately
    window.showGoogleLoader(detailsCard);
    window.showGoogleLoader(passwordCard);
    window.showGoogleLoader(preferencesCard);

    // Fetch latest user details on revisit/load
    (async () => {
      try {
        const res = await window.apiClient.me.get({ query: { _t: Date.now() } });
        Auth.user = res.data;
      } catch (e) {
        console.error('Failed to refresh user profile details on revisit:', e);
      } finally {
        // Hide loaders
        window.hideGoogleLoader(detailsCard);
        window.hideGoogleLoader(passwordCard);
        window.hideGoogleLoader(preferencesCard);

        // Replace content with fresh forms
        grid.replaceChildren();
        grid.appendChild(this.renderDetailsCard(false));
        grid.appendChild(this.renderPasswordCard(false));
        grid.appendChild(this.renderPreferencesCard(false));
      }
    })();

    return container;
  },

  getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  },

  renderDetailsCard(isLoading = false) {
    const card = el('div', { class: 'card profile-card' });

    // Card Header
    const header = el('div', { class: 'profile-card-header' });
    header.appendChild(el('h3', { class: 'profile-card-title', text: 'Your Details' }));
    header.appendChild(el('p', { class: 'profile-card-subtitle', text: 'Update your name and profile photo.' }));
    card.appendChild(header);

    const body = el('div', { class: 'profile-card-body' });

    // Avatar Row
    const avatarRow = el('div', { class: 'profile-avatar-row' });
    
    const userName = Auth.user?.name || 'VJ Dela Cruz';
    const initials = this.getInitials(userName);
    const avatarUrl = Auth.user?.avatarUrl;

    const avatarCircle = el('div', {
      class: 'profile-avatar-circle',
      id: 'profile-avatar-circle'
    });
    if (avatarUrl) {
      avatarCircle.style.backgroundImage = `url('${avatarUrl}')`;
      avatarCircle.style.backgroundSize = 'cover';
      avatarCircle.style.backgroundPosition = 'center';
      avatarCircle.textContent = '';
    } else {
      avatarCircle.textContent = initials;
    }
    avatarRow.appendChild(avatarCircle);

    const avatarInfo = el('div', { class: 'profile-avatar-info' });
    const nameDisplay = el('div', { class: 'profile-user-name', id: 'profile-user-display-name', text: userName });
    const uploadBtn = el('button', { type: 'button', class: 'profile-upload-btn', id: 'profile-upload-trigger', text: 'Upload a new photo' });
    const fileInput = el('input', { type: 'file', id: 'profile-avatar-input', accept: 'image/png,image/jpeg,image/webp', style: 'display:none;' });
    const uploadStatus = el('span', { id: 'profile-avatar-status', class: 'profile-upload-status' });

    uploadBtn.addEventListener('click', () => fileInput.click());
    if (isLoading) {
      uploadBtn.disabled = true;
    }

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        uploadStatus.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
          avatarCircle.style.backgroundImage = `url('${e.target.result}')`;
          avatarCircle.style.backgroundSize = 'cover';
          avatarCircle.style.backgroundPosition = 'center';
          avatarCircle.textContent = '';
        };
        reader.readAsDataURL(file);
      }
    });

    avatarInfo.appendChild(nameDisplay);
    avatarInfo.appendChild(uploadBtn);
    avatarInfo.appendChild(fileInput);
    avatarInfo.appendChild(uploadStatus);
    avatarRow.appendChild(avatarInfo);
    body.appendChild(avatarRow);

    // Form
    const form = el('form', { id: 'profile-details-form', class: 'profile-form' });
    form.appendChild(this.formGroup('FULL NAME', 'text', 'profile-name', userName, !isLoading, '', true));
    form.appendChild(this.formGroup('EMAIL ADDRESS', 'email', 'profile-email', Auth.user?.email || 'test-account@ata-lta.ph', false));

    const actions = el('div', { class: 'profile-form-actions' });
    const saveBtn = el('button', {
      type: 'submit',
      class: 'btn btn-primary profile-save-btn',
      text: isLoading ? 'Loading...' : 'Save Details',
      disabled: isLoading
    });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('profile-name');
      const submitBtn = form.querySelector('.profile-save-btn');
      
      window.showGoogleLoader(card);
      nameInput.disabled = true;
      fileInput.disabled = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      const name = nameInput.value.trim();
      const file = fileInput.files[0];
      let newAvatarUrl = Auth.user?.avatarUrl || null;

      if (file) {
        try {
          uploadStatus.textContent = 'Uploading...';
          const { data } = await window.apiClient.me.avatarUploadUrl();
          const uploadRes = await fetch(data.signedUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type },
          });
          if (!uploadRes.ok) throw new Error('Upload failed');
          newAvatarUrl = data.publicUrl;
          uploadStatus.textContent = 'Avatar updated.';
        } catch (err) {
          uploadStatus.textContent = err.message || 'Avatar upload failed.';
          window.hideGoogleLoader(card);
          nameInput.disabled = false;
          fileInput.disabled = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Details';
          }
          return;
        }
      }

      try {
        const updateRes = await window.apiClient.me.update({ name, avatarUrl: newAvatarUrl });
        if (updateRes && updateRes.data) {
          Auth.user = updateRes.data;
        }
        await Auth.restoreSession(); // refresh Auth.user
        window.hideGoogleLoader(card);
        Workflow.showMessage('Profile', 'Details saved.', 'success');
        App.handleRoute();
      } catch (err) {
        window.hideGoogleLoader(card);
        nameInput.disabled = false;
        fileInput.disabled = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Details';
        }
        Workflow.showMessage('Profile', err.message || 'Unable to save details.', 'error');
      }
    });

    body.appendChild(form);
    card.appendChild(body);
    return card;
  },

  /**
   * Evaluates password against security complexity requirements.
   */
  _evaluatePassword(pw) {
    const val = typeof pw === 'string' ? pw : '';
    const checks = {
      length: val.length >= 8 && val.length <= 128,
      lower: /[a-z]/.test(val),
      upper: /[A-Z]/.test(val),
      number: /[0-9]/.test(val),
      special: /[^a-zA-Z0-9]/.test(val),
    };
    const validCount = Object.values(checks).filter(Boolean).length;
    const isValid = validCount === 5;

    let strength = 'none';
    let label = 'Required';
    let activeSegments = 0;

    if (val.length > 0) {
      if (validCount <= 2) {
        strength = 'weak';
        label = 'Weak';
        activeSegments = 1;
      } else if (validCount === 3) {
        strength = 'fair';
        label = 'Fair';
        activeSegments = 2;
      } else if (validCount === 4) {
        strength = 'good';
        label = 'Good';
        activeSegments = 3;
      } else if (validCount === 5) {
        strength = 'strong';
        label = 'Strong';
        activeSegments = 4;
      }
    }

    return { val, checks, validCount, isValid, strength, label, activeSegments };
  },

  /**
   * Generates a cryptographically strong 16-character password satisfying all 5 criteria.
   */
  _generateSecurePassword() {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const all = lowercase + uppercase + numbers + symbols;

    const getSecureChar = (set) => {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        window.crypto.getRandomValues(arr);
        return set[arr[0] % set.length];
      }
      return set[Math.floor(Math.random() * set.length)];
    };

    const chars = [
      getSecureChar(uppercase),
      getSecureChar(uppercase),
      getSecureChar(lowercase),
      getSecureChar(lowercase),
      getSecureChar(numbers),
      getSecureChar(numbers),
      getSecureChar(symbols),
      getSecureChar(symbols),
    ];

    while (chars.length < 16) {
      chars.push(getSecureChar(all));
    }

    for (let i = chars.length - 1; i > 0; i--) {
      let j;
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        window.crypto.getRandomValues(arr);
        j = arr[0] % (i + 1);
      } else {
        j = Math.floor(Math.random() * (i + 1));
      }
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  },

  /**
   * Helper to ensure modern design tokens and guardrail styles are injected into document.head
   */
  _injectGuardrailsStyles() {
    if (document.getElementById('pw-guardrails-tokens-style')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'pw-guardrails-tokens-style';
    styleEl.textContent = `
/* Modern Password Guardrails & In-field Eye Toggle Design Tokens */
.pw-input-wrapper {
  position: relative !important;
  width: 100% !important;
  display: flex !important;
  align-items: center !important;
  box-sizing: border-box !important;
}
.pw-input-wrapper .pw-input {
  width: 100% !important;
  padding-right: 44px !important;
  box-sizing: border-box !important;
  font-family: inherit !important;
}
.pw-toggle-btn {
  position: absolute !important;
  right: 10px !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  padding: 6px !important;
  margin: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
  color: var(--color-text-muted, #9494a0) !important;
  border-radius: 6px !important;
  z-index: 2 !important;
  line-height: 1 !important;
  transition: color 0.15s ease, background-color 0.15s ease !important;
  box-shadow: none !important;
}
.pw-toggle-btn:hover {
  color: var(--color-text, #2d2d3f) !important;
  background: var(--color-bg, #f4f6fb) !important;
}
.pw-toggle-btn svg {
  pointer-events: none !important;
  display: block !important;
}
.pw-header-row {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  gap: 8px !important;
  min-height: 28px !important;
  margin-bottom: 4px !important;
}
.pw-header-row label {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  font-size: 0.75rem !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.04em !important;
  color: var(--color-text-muted, #9494a0) !important;
  margin: 0 !important;
  white-space: nowrap !important;
}
.pw-generate-btn {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  background: var(--color-bg, #f4f6fb) !important;
  border: 1px solid var(--color-border, #e2e8f0) !important;
  border-radius: 6px !important;
  padding: 3px 8px !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
  color: var(--color-primary, #2563eb) !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  white-space: nowrap !important;
  outline: none !important;
}
.pw-generate-btn:hover {
  background: var(--color-primary-alpha, rgba(37, 99, 235, 0.08)) !important;
  border-color: var(--color-primary, #2563eb) !important;
  color: var(--color-primary-dark, #1d4ed8) !important;
}
.pw-generate-btn svg {
  pointer-events: none !important;
  width: 12px !important;
  height: 12px !important;
}
.pw-match-badge {
  font-size: 0.7rem !important;
  font-weight: 600 !important;
  padding: 2px 8px !important;
  border-radius: 999px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.03em !important;
  transition: all 0.2s ease !important;
  white-space: nowrap !important;
}
.pw-match-badge.hidden {
  display: none !important;
}
.pw-match-badge.match-yes {
  color: #10b981 !important;
  background: rgba(16, 185, 129, 0.12) !important;
  border: 1px solid rgba(16, 185, 129, 0.25) !important;
}
.pw-match-badge.match-no {
  color: #ef4444 !important;
  background: rgba(239, 68, 68, 0.1) !important;
  border: 1px solid rgba(239, 68, 68, 0.25) !important;
}
.pw-profile-guardrails {
  display: flex !important;
  flex-direction: column !important;
  gap: 10px !important;
  background: var(--color-bg, #f4f6fb) !important;
  border: 1px solid var(--color-border, #e2e8f0) !important;
  border-radius: 12px !important;
  padding: 14px 16px !important;
  margin-top: 6px !important;
  box-sizing: border-box !important;
}
[data-theme="dark"] .pw-profile-guardrails {
  background: rgba(255, 255, 255, 0.02) !important;
  border-color: var(--color-border, #4a4a4a) !important;
}
.pw-meter-container {
  display: flex !important;
  flex-direction: column !important;
  gap: 6px !important;
}
.pw-meter-header {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  font-size: 0.75rem !important;
}
.pw-meter-title {
  color: var(--color-text-muted, #9494a0) !important;
  font-weight: 500 !important;
}
.pw-meter-badge {
  font-size: 0.7rem !important;
  font-weight: 600 !important;
  padding: 2px 8px !important;
  border-radius: 999px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.03em !important;
  transition: all 0.2s ease !important;
}
.pw-meter-badge.strength-none {
  color: var(--color-text-muted, #9494a0) !important;
  background: var(--color-surface, #ffffff) !important;
  border: 1px solid var(--color-border, #e2e8f0) !important;
}
.pw-meter-badge.strength-weak {
  color: #ef4444 !important;
  background: rgba(239, 68, 68, 0.1) !important;
  border: 1px solid rgba(239, 68, 68, 0.25) !important;
}
.pw-meter-badge.strength-fair {
  color: #f59e0b !important;
  background: rgba(245, 158, 11, 0.1) !important;
  border: 1px solid rgba(245, 158, 11, 0.25) !important;
}
.pw-meter-badge.strength-good {
  color: #3b82f6 !important;
  background: rgba(59, 130, 246, 0.1) !important;
  border: 1px solid rgba(59, 130, 246, 0.25) !important;
}
.pw-meter-badge.strength-strong {
  color: #10b981 !important;
  background: rgba(16, 185, 129, 0.12) !important;
  border: 1px solid rgba(16, 185, 129, 0.25) !important;
}
.pw-meter-segments {
  display: flex !important;
  gap: 6px !important;
  width: 100% !important;
  height: 6px !important;
}
.pw-meter-segment {
  flex: 1 !important;
  height: 100% !important;
  border-radius: 999px !important;
  background: var(--color-border, #e2e8f0) !important;
  transition: background-color 0.25s ease !important;
}
.pw-meter-segment.active-weak { background: #ef4444 !important; }
.pw-meter-segment.active-fair { background: #f59e0b !important; }
.pw-meter-segment.active-good { background: #3b82f6 !important; }
.pw-meter-segment.active-strong { background: #10b981 !important; }
.pw-checklist {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)) !important;
  gap: 6px 12px !important;
  margin-top: 4px !important;
  padding-top: 8px !important;
  border-top: 1px dashed var(--color-border, #e2e8f0) !important;
}
.pw-rule-item {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  font-size: 0.75rem !important;
  color: var(--color-text-muted, #9494a0) !important;
  padding: 5px 8px !important;
  border-radius: 8px !important;
  background: var(--color-surface, #ffffff) !important;
  border: 1px solid transparent !important;
  transition: all 0.2s ease !important;
  user-select: none !important;
}
.pw-rule-item.is-met {
  color: #059669 !important;
  background: rgba(16, 185, 129, 0.08) !important;
  border-color: rgba(16, 185, 129, 0.25) !important;
}
[data-theme="dark"] .pw-rule-item.is-met {
  color: #34d399 !important;
  background: rgba(16, 185, 129, 0.15) !important;
  border-color: rgba(16, 185, 129, 0.3) !important;
}
.pw-rule-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 14px !important;
  height: 14px !important;
  flex-shrink: 0 !important;
  color: var(--color-text-muted, #9494a0) !important;
  transition: color 0.2s ease, transform 0.2s ease !important;
}
.pw-rule-icon svg {
  pointer-events: none !important;
  display: block !important;
}
.pw-rule-item.is-met .pw-rule-icon {
  color: #10b981 !important;
  transform: scale(1.1) !important;
}
.pw-rule-text {
  font-weight: 500 !important;
  line-height: 1.2 !important;
}
.pw-match-helper {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
  margin-top: 6px !important;
  min-height: 18px !important;
  transition: all 0.2s ease !important;
}
.pw-match-helper.match-yes { color: #10b981 !important; }
.pw-match-helper.match-no { color: #ef4444 !important; }
.pw-match-helper.match-empty { color: var(--color-text-muted, #9494a0) !important; }
.pw-match-helper svg {
  width: 14px !important;
  height: 14px !important;
  flex-shrink: 0 !important;
  pointer-events: none !important;
}
.pw-input.pw-input-error {
  border-color: var(--color-danger, #ef4444) !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15) !important;
}
.pw-input.pw-input-success {
  border-color: var(--color-success, #10b981) !important;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15) !important;
}

/* Always strictly align New Password and Confirm Password fields in the row */
.profile-form-grid.pw-aligned-grid {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  column-gap: 20px !important;
  row-gap: 8px !important;
  align-items: start !important;
}

@media (min-width: 641px) {
  .profile-form-grid.pw-aligned-grid {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    grid-template-rows: auto auto auto !important;
    column-gap: 20px !important;
    row-gap: 8px !important;
    align-items: start !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-new,
  .profile-form-grid.pw-aligned-grid .pw-col-confirm {
    display: contents !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-new .pw-header-row {
    grid-column: 1 !important;
    grid-row: 1 !important;
    align-self: end !important;
    margin-bottom: 0 !important;
    min-height: 28px !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-confirm .pw-header-row {
    grid-column: 2 !important;
    grid-row: 1 !important;
    align-self: end !important;
    margin-bottom: 0 !important;
    min-height: 28px !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-new .pw-input-wrapper {
    grid-column: 1 !important;
    grid-row: 2 !important;
    align-self: start !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-confirm .pw-input-wrapper {
    grid-column: 2 !important;
    grid-row: 2 !important;
    align-self: start !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-new .pw-match-helper {
    grid-column: 1 !important;
    grid-row: 3 !important;
    align-self: start !important;
    margin-top: 0 !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-confirm .pw-match-helper {
    grid-column: 2 !important;
    grid-row: 3 !important;
    align-self: start !important;
    margin-top: 0 !important;
  }
}

@media (max-width: 640px) {
  .profile-form-grid.pw-aligned-grid {
    grid-template-columns: 1fr !important;
    row-gap: 14px !important;
  }
  .profile-form-grid.pw-aligned-grid .pw-col-new,
  .profile-form-grid.pw-aligned-grid .pw-col-confirm {
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
  }
}
`;
    document.head.appendChild(styleEl);
  },

  /**
   * Helper to create a password field with show/hide toggle and header action.
   */
  createPasswordField({ label, id, placeholder = '', editable = true, headerAction = null, required = true }) {
    const group = el('div', { class: 'profile-form-group' + (required ? ' is-required' : '') });

    const header = el('div', { class: 'pw-header-row' });
    header.appendChild(el('label', { htmlFor: id, text: label }));
    if (headerAction) {
      header.appendChild(headerAction);
    }
    group.appendChild(header);

    const wrapper = el('div', {
      class: 'pw-input-wrapper',
      style: 'position: relative; width: 100%; display: flex; align-items: center; box-sizing: border-box;'
    });
    const input = el('input', {
      type: 'password',
      id: id,
      name: id,
      disabled: !editable,
      placeholder: placeholder,
      required: required,
      class: 'profile-input pw-input',
      autocomplete: id.includes('current') ? 'current-password' : 'new-password',
      style: 'width: 100%; padding-right: 44px !important; box-sizing: border-box;'
    });
    wrapper.appendChild(input);

    const eyeIconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;display:block;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const eyeOffIconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;display:block;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

    const toggleBtn = el('button', {
      type: 'button',
      class: 'pw-toggle-btn',
      'aria-label': 'Show password',
      title: 'Show password',
      tabindex: '-1',
      style: 'position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: none; outline: none; cursor: pointer; padding: 6px; margin: 0; display: inline-flex; align-items: center; justify-content: center; z-index: 2; border-radius: 6px; color: var(--color-text-muted, #9494a0);'
    });
    toggleBtn.innerHTML = eyeIconSvg;

    const setVisibility = (visible) => {
      const targetType = visible ? 'text' : 'password';
      input.type = targetType;
      input.setAttribute('type', targetType);
      toggleBtn.innerHTML = visible ? eyeOffIconSvg : eyeIconSvg;
      const labelText = visible ? 'Hide password' : 'Show password';
      toggleBtn.setAttribute('aria-label', labelText);
      toggleBtn.setAttribute('title', labelText);
    };

    toggleBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isCurrentlyPw = input.type === 'password' || input.getAttribute('type') === 'password';
      setVisibility(isCurrentlyPw);
      try {
        input.focus({ preventScroll: true });
        if (input.setSelectionRange && input.value) {
          const len = input.value.length;
          input.setSelectionRange(len, len);
        }
      } catch (err) {}
    });
    wrapper.appendChild(toggleBtn);

    group.appendChild(wrapper);
    return { group, input, toggleBtn, eyeIconSvg, eyeOffIconSvg, setVisibility };
  },

  renderPasswordCard(isLoading = false) {
    this._injectGuardrailsStyles();
    const card = el('div', { class: 'card profile-card' });

    // Card Header
    const header = el('div', { class: 'profile-card-header' });
    header.appendChild(el('h3', { class: 'profile-card-title', text: 'Change Password' }));
    header.appendChild(el('p', { class: 'profile-card-subtitle', text: 'Use a strong password meeting modern security complexity requirements.' }));
    card.appendChild(header);

    const body = el('div', { class: 'profile-card-body' });

    const form = el('form', { id: 'profile-password-form', class: 'profile-form', novalidate: 'true' });

    // Current Password with show/hide toggle
    const currentField = this.createPasswordField({
      label: 'CURRENT PASSWORD',
      id: 'profile-current-password',
      placeholder: '•••••••••••••',
      editable: !isLoading
    });
    const currentPassHelper = el('div', {
      id: 'profile-current-pass-helper',
      class: 'pw-match-helper match-empty'
    });
    currentField.group.appendChild(currentPassHelper);
    form.appendChild(currentField.group);

    // New Password header generate button
    const generateBtn = el('button', {
      type: 'button',
      class: 'pw-generate-btn',
      title: 'Generate a secure random password satisfying all requirements'
    });
    generateBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L14 9M3 21l6.5-6.5a4.95 4.95 0 0 1 0-7 4.95 4.95 0 0 1 7 0l2 2a4.95 4.95 0 0 1 0 7l-6.5 6.5-5 1 1-5Z"/></svg> Generate Password';

    // New Password field
    const newPassField = this.createPasswordField({
      label: 'NEW PASSWORD',
      id: 'profile-new-password',
      placeholder: 'Enter new secure password',
      editable: !isLoading,
      headerAction: generateBtn
    });

    // Confirm Password match badge
    const matchBadge = el('span', {
      id: 'profile-match-badge',
      class: 'pw-match-badge hidden',
      text: ''
    });

    // Confirm Password field
    const confirmField = this.createPasswordField({
      label: 'CONFIRM NEW PASSWORD',
      id: 'profile-confirm-password',
      placeholder: 'Repeat new password',
      editable: !isLoading,
      headerAction: matchBadge
    });

    // Sub-field helper indicators
    const newPassHelper = el('div', {
      id: 'profile-new-pass-helper',
      class: 'pw-match-helper match-empty',
      text: 'Must be 8+ characters with uppercase, lowercase, number, and special character'
    });
    newPassField.group.appendChild(newPassHelper);

    const confirmMatchHelper = el('div', {
      id: 'profile-confirm-match-helper',
      class: 'pw-match-helper match-empty'
    });
    confirmField.group.appendChild(confirmMatchHelper);

    // Grid for New Password and Confirm Password
    newPassField.group.classList.add('pw-col-new');
    confirmField.group.classList.add('pw-col-confirm');

    const grid = el('div', { class: 'profile-form-grid pw-aligned-grid' });
    grid.appendChild(newPassField.group);
    grid.appendChild(confirmField.group);
    form.appendChild(grid);

    // Guardrails Container: Strength Meter & Live Checklist
    const guardrailsContainer = el('div', { class: 'pw-profile-guardrails' });

    // Segmented strength meter
    const meterContainer = el('div', { class: 'pw-meter-container' });
    const meterHeader = el('div', { class: 'pw-meter-header' });
    meterHeader.appendChild(el('span', { class: 'pw-meter-title', text: 'Password Strength' }));

    const meterBadge = el('span', { class: 'pw-meter-badge strength-none', text: 'Required' });
    meterHeader.appendChild(meterBadge);
    meterContainer.appendChild(meterHeader);

    const segmentsWrapper = el('div', { class: 'pw-meter-segments' });
    const segments = [
      el('div', { class: 'pw-meter-segment' }),
      el('div', { class: 'pw-meter-segment' }),
      el('div', { class: 'pw-meter-segment' }),
      el('div', { class: 'pw-meter-segment' })
    ];
    segments.forEach(s => segmentsWrapper.appendChild(s));
    meterContainer.appendChild(segmentsWrapper);
    guardrailsContainer.appendChild(meterContainer);

    // Live criteria checklist
    const checklist = el('div', { class: 'pw-checklist' });
    const rules = [
      { key: 'length', label: '8–128 characters' },
      { key: 'upper', label: 'Uppercase letter (A–Z)' },
      { key: 'lower', label: 'Lowercase letter (a–z)' },
      { key: 'number', label: 'Numeric digit (0–9)' },
      { key: 'special', label: 'Special character (e.g. !@#$)' }
    ];

    const checkIconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const circleIconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/></svg>';

    const ruleEls = {};
    rules.forEach(rule => {
      const item = el('div', { class: 'pw-rule-item', 'data-rule': rule.key });
      const iconSpan = el('span', { class: 'pw-rule-icon', html: circleIconSvg });
      const textSpan = el('span', { class: 'pw-rule-text', text: rule.label });
      item.appendChild(iconSpan);
      item.appendChild(textSpan);
      checklist.appendChild(item);
      ruleEls[rule.key] = { item, iconSpan };
    });
    guardrailsContainer.appendChild(checklist);
    form.appendChild(guardrailsContainer);

    const errorEl = el('div', { class: 'field-error hidden', style: 'margin-top: var(--spacing-sm);' });
    form.appendChild(errorEl);

    const actions = el('div', { class: 'profile-form-actions' });
    const saveBtn = el('button', {
      type: 'submit',
      class: 'btn btn-primary profile-save-btn',
      text: isLoading ? 'Loading...' : 'Update Password',
      disabled: isLoading
    });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    // Real-time UI updater
    const updateUI = () => {
      const val = newPassField.input.value;
      const confirmVal = confirmField.input.value;

      card.classList.remove('pw-shake');

      const evalRes = this._evaluatePassword(val);

      rules.forEach(r => {
        const isMet = evalRes.checks[r.key];
        if (isMet) {
          ruleEls[r.key].item.classList.add('is-met');
          ruleEls[r.key].iconSpan.innerHTML = checkIconSvg;
        } else {
          ruleEls[r.key].item.classList.remove('is-met');
          ruleEls[r.key].iconSpan.innerHTML = circleIconSvg;
        }
      });

      meterBadge.className = `pw-meter-badge strength-${evalRes.strength}`;
      meterBadge.textContent = evalRes.strength === 'none' ? 'Required' : evalRes.label;

      segments.forEach((seg, idx) => {
        seg.className = 'pw-meter-segment';
        if (idx < evalRes.activeSegments) {
          seg.classList.add(`active-${evalRes.strength}`);
        }
      });

      if (!val) {
        newPassField.input.classList.remove('pw-input-error', 'pw-input-success');
        newPassHelper.className = 'pw-match-helper match-empty';
        newPassHelper.textContent = 'Must be 8+ characters with uppercase, lowercase, number, and special character';
      } else if (evalRes.isValid) {
        newPassField.input.classList.remove('pw-input-error');
        newPassField.input.classList.add('pw-input-success');
        newPassHelper.className = 'pw-match-helper match-yes';
        newPassHelper.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Meets all complexity criteria';
      } else {
        newPassField.input.classList.remove('pw-input-success');
        newPassHelper.className = 'pw-match-helper match-no';
        newPassHelper.textContent = `${5 - evalRes.validCount} requirement(s) remaining`;
      }

      if (!confirmVal) {
        matchBadge.className = 'pw-match-badge hidden';
        matchBadge.textContent = '';
        confirmMatchHelper.className = 'pw-match-helper match-empty';
        confirmMatchHelper.textContent = val ? 'Please repeat your new password' : '';
        confirmField.input.classList.remove('pw-input-error', 'pw-input-success');
      } else if (confirmVal === val && val.length > 0) {
        matchBadge.className = 'pw-match-badge match-yes';
        matchBadge.textContent = '✓ Match';
        confirmMatchHelper.className = 'pw-match-helper match-yes';
        confirmMatchHelper.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Passwords match';
        confirmField.input.classList.remove('pw-input-error');
        confirmField.input.classList.add('pw-input-success');
      } else {
        matchBadge.className = 'pw-match-badge match-no';
        matchBadge.textContent = '✕ No match';
        confirmMatchHelper.className = 'pw-match-helper match-no';
        confirmMatchHelper.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Passwords do not match';
        confirmField.input.classList.remove('pw-input-success');
        confirmField.input.classList.add('pw-input-error');
      }

      if (evalRes.isValid && confirmVal === val) {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
      }
    };

    newPassField.input.addEventListener('input', updateUI);
    confirmField.input.addEventListener('input', updateUI);
    currentField.input.addEventListener('input', () => {
      currentField.input.classList.remove('pw-input-error');
      currentPassHelper.className = 'pw-match-helper match-empty';
      currentPassHelper.textContent = '';
      if (errorEl.textContent && errorEl.textContent.toLowerCase().includes('current password')) {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
      }
    });

    generateBtn.addEventListener('click', () => {
      const generated = this._generateSecurePassword();
      newPassField.input.value = generated;
      confirmField.input.value = generated;

      newPassField.setVisibility(true);
      confirmField.setVisibility(true);

      updateUI();

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(generated).catch(() => {});
      }

      if (typeof Workflow !== 'undefined' && typeof Workflow.showMessage === 'function') {
        Workflow.showMessage('Password Generated', 'Strong password generated and copied to clipboard.', 'success');
      }

      newPassField.input.focus();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentInput = currentField.input;
      const newPassInput = newPassField.input;
      const confirmInput = confirmField.input;

      const current = currentInput.value ? currentInput.value.trim() : '';
      const newPass = newPassInput.value ? newPassInput.value.trim() : '';
      const confirm = confirmInput.value ? confirmInput.value.trim() : '';

      errorEl.classList.add('hidden');
      errorEl.textContent = '';
      currentPassHelper.className = 'pw-match-helper match-empty';
      currentPassHelper.textContent = '';
      currentInput.classList.remove('pw-input-error');
      newPassInput.classList.remove('pw-input-error');
      confirmInput.classList.remove('pw-input-error');

      const triggerShake = (targetInput) => {
        card.classList.remove('pw-shake');
        void card.offsetWidth;
        card.classList.add('pw-shake');
        if (targetInput) {
          targetInput.classList.add('pw-input-error');
          targetInput.focus();
        }
      };

      if (!current) {
        errorEl.textContent = 'Current password is required.';
        errorEl.classList.remove('hidden');
        currentPassHelper.className = 'pw-match-helper match-no';
        currentPassHelper.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Current password is required.';
        triggerShake(currentInput);
        return;
      }

      if (!newPass) {
        errorEl.textContent = 'New password is required.';
        errorEl.classList.remove('hidden');
        triggerShake(newPassInput);
        return;
      }

      const evalRes = this._evaluatePassword(newPass);
      if (!evalRes.isValid) {
        errorEl.textContent = 'New password must satisfy all 5 security requirements below.';
        errorEl.classList.remove('hidden');
        triggerShake(newPassInput);
        return;
      }

      if (newPass !== confirm) {
        errorEl.textContent = 'New passwords do not match.';
        errorEl.classList.remove('hidden');
        triggerShake(confirmInput);
        return;
      }

      if (current === newPass) {
        errorEl.textContent = 'New password must be different from your current password.';
        errorEl.classList.remove('hidden');
        triggerShake(newPassInput);
        return;
      }

      window.showGoogleLoader(card);
      currentInput.disabled = true;
      newPassInput.disabled = true;
      confirmInput.disabled = true;
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Updating...';
      }

      try {
        await window.apiClient.me.changePassword({ currentPassword: current, newPassword: newPass });
        window.hideGoogleLoader(card);
        Workflow.showMessage('Password', 'Password updated successfully.', 'success');
        form.reset();
        currentPassHelper.className = 'pw-match-helper match-empty';
        currentPassHelper.textContent = '';
        updateUI();
        currentInput.disabled = false;
        newPassInput.disabled = false;
        confirmInput.disabled = false;
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Update Password';
        }
      } catch (err) {
        window.hideGoogleLoader(card);
        currentInput.disabled = false;
        newPassInput.disabled = false;
        confirmInput.disabled = false;
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Update Password';
        }
        const errMsg = err.message || 'Unable to update password.';
        errorEl.textContent = errMsg;
        errorEl.classList.remove('hidden');
        if (/current password/i.test(errMsg)) {
          currentPassHelper.className = 'pw-match-helper match-no';
          currentPassHelper.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ' + errMsg;
          triggerShake(currentInput);
        } else if (/new password/i.test(errMsg)) {
          triggerShake(newPassInput);
        } else {
          triggerShake();
        }
      }
    });

    updateUI();
    body.appendChild(form);
    card.appendChild(body);
    return card;
  },

  renderPreferencesCard(isLoading = false) {
    const card = el('div', { class: 'card profile-card' });

    // Card Header
    const header = el('div', { class: 'profile-card-header' });
    header.appendChild(el('h3', { class: 'profile-card-title', text: 'Preferences' }));
    header.appendChild(el('p', { class: 'profile-card-subtitle', text: 'Customize your display settings.' }));
    card.appendChild(header);

    const body = el('div', { class: 'profile-card-body' });

    const prefs = Auth.user?.preferences || {};
    const storedTheme = localStorage.getItem('erp_theme') || 'system';
    const storedDefaultView = App.getPreferredViewMode('operations') || 'table';

    const form = el('form', { id: 'profile-preferences-form', class: 'profile-form' });

    const grid = el('div', { class: 'profile-form-grid' });
    grid.appendChild(this.selectGroup('THEME', 'profile-theme', [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System default' }
    ], storedTheme, isLoading));

    grid.appendChild(this.selectGroup('DEFAULT LIST VIEW', 'profile-default-view', [
      { value: 'table', label: 'Table' },
      { value: 'list', label: 'List' },
      { value: 'board', label: 'Board' }
    ], prefs.defaultView || storedDefaultView, isLoading));

    grid.appendChild(this.selectGroup('DEFAULT FORM VIEW', 'profile-default-form-view', [
      { value: 'side-peek', label: 'Side peek' },
      { value: 'center-peek', label: 'Center peek' },
      { value: 'full-page', label: 'Full page' },
      { value: 'new-tab', label: 'New tab' }
    ], prefs.defaultFormView || 'side-peek', isLoading));

    form.appendChild(grid);

    const actions = el('div', { class: 'profile-form-actions' });
    const saveBtn = el('button', {
      type: 'submit',
      class: 'btn btn-primary profile-save-btn',
      text: isLoading ? 'Loading...' : 'Save Preferences',
      disabled: isLoading
    });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const themeSelect = document.getElementById('profile-theme');
      const viewSelect = document.getElementById('profile-default-view');
      const formViewSelect = document.getElementById('profile-default-form-view');
      const submitBtn = form.querySelector('.profile-save-btn');

      const theme = themeSelect.value;
      const defaultView = viewSelect.value;
      const defaultFormView = formViewSelect.value;

      window.showGoogleLoader(card);
      themeSelect.disabled = true;
      viewSelect.disabled = true;
      formViewSelect.disabled = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      try {
        const updateRes = await window.apiClient.me.update({
          preferences: {
            ...prefs,
            defaultView,
            theme,
            defaultFormView
          }
        });

        if (updateRes && updateRes.data) {
          Auth.user = updateRes.data;
        }

        if (typeof Auth !== 'undefined' && typeof Auth.restoreSession === 'function') {
          await Auth.restoreSession();
        }

        // Apply theme immediately
        if (theme === 'system') {
          localStorage.removeItem('erp_theme');
          App.initTheme();
        } else {
          localStorage.setItem('erp_theme', theme);
          App.applyTheme(theme);
        }

        App.setPreferredViewMode('operations', defaultView);
        App.setPreferredViewMode('billing', defaultView);
        App.setPreferredViewMode('disbursement', defaultView);
        App.setPreferredViewMode('transmittals', defaultView);

        window.hideGoogleLoader(card);
        Workflow.showMessage('Preferences', 'Preferences saved.', 'success');

        App.handleRoute();
      } catch (err) {
        window.hideGoogleLoader(card);
        themeSelect.disabled = false;
        viewSelect.disabled = false;
        formViewSelect.disabled = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Preferences';
        }
        Workflow.showMessage('Preferences', err.message || 'Unable to save preferences.', 'error');
      }
    });

    body.appendChild(form);
    card.appendChild(body);
    return card;
  },

  formGroup(label, type, id, value, editable, placeholder = '', required = false) {
    const group = el('div', { class: 'profile-form-group' + (required ? ' is-required' : '') });
    group.appendChild(el('label', { htmlFor: id, text: label }));
    const input = el('input', {
      type: type,
      id: id,
      name: id,
      value: value,
      disabled: !editable,
      placeholder: placeholder,
      required: required,
      class: 'form-input'
    });
    group.appendChild(input);
    return group;
  },

  selectGroup(label, id, options, selectedValue, disabled = false) {
    const group = el('div', { class: 'profile-form-group' });
    group.appendChild(el('label', { htmlFor: id, text: label }));
    const select = el('select', { id, class: 'form-select profile-select', disabled });
    options.forEach((opt) => {
      const option = el('option', { value: opt.value, text: opt.label });
      if (opt.value === selectedValue) option.selected = true;
      select.appendChild(option);
    });
    group.appendChild(select);
    return group;
  },

  init() {}
};
