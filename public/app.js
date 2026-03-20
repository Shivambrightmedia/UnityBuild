document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const passwordInput = document.getElementById('password-input');
    const adminPanel = document.getElementById('admin-panel');
    const uploadBtn = document.getElementById('upload-file-btn');
    const fileInput = document.getElementById('file-input');
    const eventNameInput = document.getElementById('event-name');
    const buildInfoInput = document.getElementById('build-info');
    const buildsList = document.getElementById('builds-list');
    const refreshBuildsBtn = document.getElementById('refresh-builds-btn');
    const linksList = document.getElementById('links-list');
    const addLinkBtn = document.getElementById('add-link-btn');
    const linkTitle = document.getElementById('link-title');
    const linkUrl = document.getElementById('link-url');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressFill = document.getElementById('progress-fill');

    // Modal Elements
    const modal = document.getElementById('custom-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalInputContainer = document.getElementById('modal-input-container');
    const modalInput = document.getElementById('modal-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');

    let isAdminUser = false;
    let modalResolve = null;

    // --- Toast Notifications ---
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // --- Custom Modal (Replacement for alert/confirm/prompt) ---
    function showModal({ title, message, showInput = false, confirmText = 'Confirm', cancelText = 'Cancel' }) {
        return new Promise((resolve) => {
            modalTitle.textContent = title;
            modalMessage.textContent = message;
            modalInputContainer.style.display = showInput ? 'block' : 'none';
            modalInput.value = '';
            modalConfirmBtn.textContent = confirmText;
            modalCancelBtn.textContent = cancelText;
            modal.style.display = 'flex';
            
            if (showInput) setTimeout(() => modalInput.focus(), 100);

            modalResolve = resolve;
        });
    }

    modalConfirmBtn.addEventListener('click', () => {
        const value = modalInputContainer.style.display === 'block' ? modalInput.value : true;
        closeModal(value);
    });

    modalCancelBtn.addEventListener('click', () => closeModal(null));

    function closeModal(value) {
        modal.style.display = 'none';
        if (modalResolve) modalResolve(value);
        modalResolve = null;
    }

    // --- Authentication ---
    async function checkAuth() {
        try {
            const res = await fetch('/api/auth/status');
            const data = await res.json();
            isAdminUser = data.isAdmin;
            updateUI();
        } catch (e) {
            console.error("Auth check failed", e);
        }
    }

    loginBtn.addEventListener('click', async () => {
        const password = passwordInput.value;
        if (!password) {
            showToast('Please enter a password', 'error');
            return;
        }

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();

            if (data.success) {
                isAdminUser = true;
                passwordInput.value = '';
                showToast('Logged in successfully', 'success');
                updateUI();
            } else {
                showToast('Invalid password', 'error');
            }
        } catch (e) {
            showToast('Login failed', 'error');
        }
    });

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        isAdminUser = false;
        showToast('Logged out');
        updateUI();
    });

    function updateUI() {
        if (isAdminUser) {
            loginBtn.style.display = 'none';
            passwordInput.style.display = 'none';
            logoutBtn.style.display = 'inline-block';
            adminPanel.style.display = 'block';
        } else {
            loginBtn.style.display = 'inline-block';
            passwordInput.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
            adminPanel.style.display = 'none';
        }
        loadBuilds();
        loadLinks();
    }

    // --- Builds Management ---
    refreshBuildsBtn.addEventListener('click', loadBuilds);

    uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
            showToast('Please select a .zip file first', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('eventName', eventNameInput.value);
        formData.append('buildInfo', buildInfoInput.value);

        progressContainer.style.display = 'block';
        progressFill.style.width = '30%'; 
        uploadBtn.disabled = true;

        try {
            const res = await fetch('/api/files', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                progressFill.style.width = '100%';
                showToast('Build uploaded successfully!', 'success');
                fileInput.value = '';
                eventNameInput.value = '';
                buildInfoInput.value = '';
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    progressFill.style.width = '0%';
                }, 1000);
                loadBuilds();
            } else {
                const err = await res.json();
                showToast('Upload failed: ' + err.error, 'error');
                progressContainer.style.display = 'none';
            }
        } catch (error) {
            showToast('Network error occurred.', 'error');
            progressContainer.style.display = 'none';
        } finally {
            uploadBtn.disabled = false;
        }
    });

    async function loadBuilds() {
        buildsList.innerHTML = '<li style="color: var(--text-light)">Loading builds...</li>';
        try {
            const res = await fetch('/api/files');
            const data = await res.json();

            buildsList.innerHTML = '';
            if (!data.files || data.files.length === 0) {
                buildsList.innerHTML = '<li style="color: var(--text-light)">No builds found</li>';
                return;
            }

            data.files.forEach(file => {
                const li = document.createElement('li');
                const sizeInMB = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
                const date = new Date(file.lastModified).toLocaleDateString();

                li.innerHTML = `
                    <div class="build-info">
                        <a href="#" class="build-name" onclick="event.preventDefault(); window.downloadFile('${file.key}')">${file.key}</a>
                        <span class="build-meta">
                            <strong>Event:</strong> ${file.eventName}<br>
                            <strong>Info:</strong> ${file.buildInfo}<br>
                            ${sizeInMB} • ${date}
                        </span>
                    </div>
                    ${isAdminUser ? `<button class="delete-btn icon-btn" onclick="window.deleteFile('${file.key}')" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>` : ''}
                `;
                buildsList.appendChild(li);
            });
        } catch (e) {
            buildsList.innerHTML = '<li style="color: var(--danger)">Failed to load builds</li>';
        }
    }

    window.downloadFile = async (key) => {
        let password = "";
        if (!isAdminUser) {
            password = await showModal({
                title: 'Download Build',
                message: `Enter password to download: ${key}`,
                showInput: true,
                confirmText: 'Download'
            });
            if (password === null) return;
        }

        try {
            const res = await fetch('/api/files/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, password })
            });

            if (res.ok) {
                const data = await res.json();
                const a = document.createElement('a');
                a.href = data.url;
                a.download = key;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                showToast('Download started');
            } else {
                showToast('Invalid password or access denied', 'error');
            }
        } catch (error) {
            showToast('Error requesting download link', 'error');
        }
    };

    window.deleteFile = async (key) => {
        const confirmed = await showModal({
            title: 'Delete Build',
            message: `Are you sure you want to delete "${key}"? This cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });

        if (!confirmed) return;

        try {
            const res = await fetch('/api/files/' + encodeURIComponent(key), {
                method: 'DELETE'
            });

            if (res.ok) {
                showToast('Build deleted successfully', 'success');
                loadBuilds();
            } else {
                showToast('Failed to delete build', 'error');
            }
        } catch (e) {
            showToast('Network error', 'error');
        }
    };

    // --- Web Links Management ---
    addLinkBtn.addEventListener('click', async () => {
        if (!linkTitle.value || !linkUrl.value) {
            showToast('Please enter both title and URL', 'error');
            return;
        }

        try {
            const res = await fetch('/api/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: linkTitle.value, url: linkUrl.value })
            });

            if (res.ok) {
                showToast('Link saved successfully', 'success');
                linkTitle.value = '';
                linkUrl.value = '';
                loadLinks();
            } else {
                showToast('Failed to save link', 'error');
            }
        } catch (e) {
            showToast('Network error', 'error');
        }
    });

    async function loadLinks() {
        linksList.innerHTML = '<li style="color: var(--text-light)">Loading links...</li>';
        try {
            const res = await fetch('/api/links');
            const data = await res.json();

            linksList.innerHTML = '';
            if (!data.links || data.links.length === 0) {
                linksList.innerHTML = '<li style="color: var(--text-light)">No links found</li>';
                return;
            }

            data.links.forEach(link => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <a href="${link.url}" target="_blank" class="build-name">${link.title}</a>
                    ${isAdminUser ? `<button class="delete-btn icon-btn" onclick="window.deleteLink('${link.id}', '${link.title}')" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>` : ''}
                `;
                linksList.appendChild(li);
            });
        } catch (e) {
            linksList.innerHTML = '<li style="color: var(--danger)">Failed to load links</li>';
        }
    }

    window.deleteLink = async (id, title) => {
        const confirmed = await showModal({
            title: 'Delete Link',
            message: `Delete link "${title}"?`,
            confirmText: 'Delete'
        });

        if (!confirmed) return;

        try {
            const res = await fetch('/api/links/' + id, {
                method: 'DELETE'
            });

            if (res.ok) {
                showToast('Link removed', 'success');
                loadLinks();
            } else {
                showToast('Failed to remove link', 'error');
            }
        } catch (e) {
            showToast('Network error', 'error');
        }
    };

    // Initial Load
    checkAuth();
});
