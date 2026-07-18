/**
 * User Profile page.
 * Allows viewing details, updating name/avatar, changing password,
 * and setting preferences (theme, default filter view).
 */

const Profile = {
  render() {
    const container = el('div', { class: 'page profile-page' });

    const titleBar = el('div', { class: 'page-title-bar-v2' });
    titleBar.appendChild(el('h1', { class: 'page-title-h1', text: 'Profile' }));
    container.appendChild(titleBar);

    const grid = el('div', { class: 'profile-grid', style: 'display: grid; grid-template-columns: 1fr; gap: var(--spacing-md); max-width: 720px;' });

    grid.appendChild(this.renderDetailsCard());
    grid.appendChild(this.renderPasswordCard());
    grid.appendChild(this.renderPreferencesCard());

    container.appendChild(grid);
    return container;
  },

  renderDetailsCard() {
    const card = el('div', { class: 'card profile-card' });
    card.appendChild(el('h3', { text: 'Your Details' }));

    const avatarUrl = Auth.user?.avatarUrl || this.defaultAvatarUrl(Auth.user?.name);
    const avatar = el('div', {
      class: 'avatar profile-avatar',
      style: `width:64px;height:64px;background-image:url('${avatarUrl}');background-size:cover;background-position:center;`
    });
    card.appendChild(avatar);

    const form = el('form', { id: 'profile-details-form', class: 'form-stacked' });
    form.appendChild(this.formGroup('Name', 'text', 'profile-name', Auth.user?.name || '', true));
    form.appendChild(this.formGroup('Email', 'email', 'profile-email', Auth.user?.email || '', false));

    const fileGroup = el('div', { class: 'form-group' });
    fileGroup.appendChild(el('label', { text: 'Avatar' }));
    const fileInput = el('input', { type: 'file', id: 'profile-avatar-input', accept: 'image/png,image/jpeg,image/webp' });
    fileGroup.appendChild(fileInput);
    const uploadStatus = el('span', { id: 'profile-avatar-status', class: 'text-muted', style: 'font-size:0.875rem;' });
    fileGroup.appendChild(uploadStatus);
    form.appendChild(fileGroup);

    const actions = el('div', { class: 'form-actions' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Save Details' });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('profile-name').value.trim();
      const file = fileInput.files[0];
      let avatarUrl = Auth.user?.avatarUrl || null;

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
          avatarUrl = data.publicUrl;
          uploadStatus.textContent = 'Avatar updated.';
        } catch (err) {
          uploadStatus.textContent = err.message || 'Avatar upload failed.';
          return;
        }
      }

      try {
        await window.apiClient.me.update({ name, avatarUrl });
        await Auth.restoreSession(); // refresh Auth.user
        Workflow.showMessage('Profile', 'Details saved.', 'success');
        App.handleRoute();
      } catch (err) {
        Workflow.showMessage('Profile', err.message || 'Unable to save details.', 'error');
      }
    });

    card.appendChild(form);
    return card;
  },

  renderPasswordCard() {
    const card = el('div', { class: 'card profile-card' });
    card.appendChild(el('h3', { text: 'Change Password' }));

    const form = el('form', { id: 'profile-password-form', class: 'form-stacked' });
    form.appendChild(this.formGroup('Current Password', 'password', 'profile-current-password', '', true));
    form.appendChild(this.formGroup('New Password', 'password', 'profile-new-password', '', true));
    form.appendChild(this.formGroup('Confirm New Password', 'password', 'profile-confirm-password', '', true));

    const errorEl = el('div', { class: 'field-error hidden', style: 'margin-top: var(--spacing-sm);' });
    form.appendChild(errorEl);

    const actions = el('div', { class: 'form-actions' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Update Password' });
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

    card.appendChild(form);
    return card;
  },

  renderPreferencesCard() {
    const card = el('div', { class: 'card profile-card' });
    card.appendChild(el('h3', { text: 'Preferences' }));

    const prefs = Auth.user?.preferences || {};
    const storedTheme = localStorage.getItem('erp_theme') || 'system';
    const storedDefaultView = App.getPreferredViewMode('operations') || 'list';

    const form = el('form', { id: 'profile-preferences-form', class: 'form-stacked' });

    form.appendChild(this.selectGroup('Theme', 'profile-theme', [
      { value: 'system', label: 'System default' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' }
    ], storedTheme));

    form.appendChild(this.selectGroup('Default list view', 'profile-default-view', [
      { value: 'list', label: 'List' },
      { value: 'table', label: 'Table' },
      { value: 'board', label: 'Board' }
    ], prefs.defaultView || storedDefaultView));

    const actions = el('div', { class: 'form-actions' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Save Preferences' });
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const theme = document.getElementById('profile-theme').value;
      const defaultView = document.getElementById('profile-default-view').value;

      try {
        await window.apiClient.me.update({
          preferences: {
            defaultView,
            theme
          }
        });

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

    card.appendChild(form);
    return card;
  },

  formGroup(label, type, id, value, editable) {
    const group = el('div', { class: 'form-group' });
    group.appendChild(el('label', { htmlFor: id, text: label }));
    const input = el('input', {
      type,
      id,
      class: 'form-input',
      value,
      disabled: !editable
    });
    group.appendChild(input);
    return group;
  },

  selectGroup(label, id, options, selectedValue) {
    const group = el('div', { class: 'form-group' });
    group.appendChild(el('label', { htmlFor: id, text: label }));
    const select = el('select', { id, class: 'form-select' });
    options.forEach((opt) => {
      const option = el('option', { value: opt.value, text: opt.label });
      if (opt.value === selectedValue) option.selected = true;
      select.appendChild(option);
    });
    group.appendChild(select);
    return group;
  },

  defaultAvatarUrl(name) {
    const safeName = encodeURIComponent(name || 'User');
    return `https://ui-avatars.com/api/?name=${safeName}&background=2563eb&color=fff`;
  },

  init() {
    // No side-pane or dynamic refresh needed for this static form page.
  }
};
