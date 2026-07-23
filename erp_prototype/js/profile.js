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

    grid.appendChild(this.renderDetailsCard());
    grid.appendChild(this.renderPasswordCard());
    grid.appendChild(this.renderPreferencesCard());

    container.appendChild(grid);
    return container;
  },

  getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  },

  renderDetailsCard() {
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
    form.appendChild(this.formGroup('FULL NAME', 'text', 'profile-name', userName, true));
    form.appendChild(this.formGroup('EMAIL ADDRESS', 'email', 'profile-email', Auth.user?.email || 'test-account@ata-lta.ph', false));

    const actions = el('div', { class: 'profile-form-actions' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary profile-save-btn', text: 'Save Details' });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('profile-name').value.trim();
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
          return;
        }
      }

      try {
        await window.apiClient.me.update({ name, avatarUrl: newAvatarUrl });
        await Auth.restoreSession(); // refresh Auth.user
        Workflow.showMessage('Profile', 'Details saved.', 'success');
        App.handleRoute();
      } catch (err) {
        Workflow.showMessage('Profile', err.message || 'Unable to save details.', 'error');
      }
    });

    body.appendChild(form);
    card.appendChild(body);
    return card;
  },

  renderPasswordCard() {
    const card = el('div', { class: 'card profile-card' });

    // Card Header
    const header = el('div', { class: 'profile-card-header' });
    header.appendChild(el('h3', { class: 'profile-card-title', text: 'Change Password' }));
    header.appendChild(el('p', { class: 'profile-card-subtitle', text: 'Use a strong password of at least 8 characters.' }));
    card.appendChild(header);

    const body = el('div', { class: 'profile-card-body' });

    const form = el('form', { id: 'profile-password-form', class: 'profile-form' });

    // Current Password
    form.appendChild(this.formGroup('CURRENT PASSWORD', 'password', 'profile-current-password', '', true, '•••••••••••••'));

    // Grid for New Password and Confirm Password
    const grid = el('div', { class: 'profile-form-grid' });
    grid.appendChild(this.formGroup('NEW PASSWORD', 'password', 'profile-new-password', '', true, 'Min. 8 characters'));
    grid.appendChild(this.formGroup('CONFIRM NEW PASSWORD', 'password', 'profile-confirm-password', '', true, 'Repeat password'));
    form.appendChild(grid);

    const errorEl = el('div', { class: 'field-error hidden', style: 'margin-top: var(--spacing-sm);' });
    form.appendChild(errorEl);

    const actions = el('div', { class: 'profile-form-actions' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary profile-save-btn', text: 'Update Password' });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = document.getElementById('profile-current-password').value;
      const newPass = document.getElementById('profile-new-password').value;
      const confirm = document.getElementById('profile-confirm-password').value;

      errorEl.classList.add('hidden');
      if (newPass.length < 8) {
        errorEl.textContent = 'New password must be at least 8 characters.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (newPass !== confirm) {
        errorEl.textContent = 'New passwords do not match.';
        errorEl.classList.remove('hidden');
        return;
      }

      try {
        await window.apiClient.me.changePassword({ currentPassword: current, newPassword: newPass });
        Workflow.showMessage('Password', 'Password updated.', 'success');
        form.reset();
      } catch (err) {
        errorEl.textContent = err.message || 'Unable to update password.';
        errorEl.classList.remove('hidden');
      }
    });

    body.appendChild(form);
    card.appendChild(body);
    return card;
  },

  renderPreferencesCard() {
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
    ], storedTheme));

    grid.appendChild(this.selectGroup('DEFAULT LIST VIEW', 'profile-default-view', [
      { value: 'table', label: 'Table' },
      { value: 'list', label: 'List' },
      { value: 'board', label: 'Board' }
    ], prefs.defaultView || storedDefaultView));

    grid.appendChild(this.selectGroup('DEFAULT FORM VIEW', 'profile-default-form-view', [
      { value: 'side-peek', label: 'Side peek' },
      { value: 'center-peek', label: 'Center peek' },
      { value: 'full-page', label: 'Full page' },
      { value: 'new-tab', label: 'New tab' }
    ], prefs.defaultFormView || 'side-peek'));

    form.appendChild(grid);

    const actions = el('div', { class: 'profile-form-actions' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary profile-save-btn', text: 'Save Preferences' });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const theme = document.getElementById('profile-theme').value;
      const defaultView = document.getElementById('profile-default-view').value;
      const defaultFormView = document.getElementById('profile-default-form-view').value;

      try {
        await window.apiClient.me.update({
          preferences: {
            ...prefs,
            defaultView,
            theme,
            defaultFormView
          }
        });

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

        Workflow.showMessage('Preferences', 'Preferences saved.', 'success');
      } catch (err) {
        Workflow.showMessage('Preferences', err.message || 'Unable to save preferences.', 'error');
      }
    });

    body.appendChild(form);
    card.appendChild(body);
    return card;
  },

  formGroup(label, type, id, value, editable, placeholder = '') {
    const group = el('div', { class: 'profile-form-group' });
    group.appendChild(el('label', { htmlFor: id, text: label }));
    const input = el('input', {
      type,
      id,
      class: 'form-input profile-input',
      value: value || '',
      placeholder,
      disabled: !editable
    });
    group.appendChild(input);
    return group;
  },

  selectGroup(label, id, options, selectedValue) {
    const group = el('div', { class: 'profile-form-group' });
    group.appendChild(el('label', { htmlFor: id, text: label }));
    const select = el('select', { id, class: 'form-select profile-select' });
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
