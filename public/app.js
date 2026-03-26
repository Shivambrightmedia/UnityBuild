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
    const buildSearchInput = document.getElementById('build-search');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');

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
    let allBuilds = [];

    // --- Helpers ---
    function formatDateTime(isoString) {
        if (!isoString) return 'Never';
        const date = new Date(isoString);
        return date.toLocaleString();
    }

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

    // --- Custom Modal ---
    function showModal({ title, message, showInput = false, confirmText = 'Confirm', cancelText = 'Cancel', placeholder = 'Enter password...' }) {
        return new Promise((resolve) => {
            modalTitle.textContent = title;
            modalMessage.textContent = message;
            modalInputContainer.style.display = showInput ? 'block' : 'none';
            modalInput.value = '';
            modalInput.placeholder = placeholder;
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

    buildSearchInput.addEventListener('input', () => {
        renderBuilds(buildSearchInput.value.toLowerCase());
    });

    startDateInput.addEventListener('change', () => renderBuilds(buildSearchInput.value.toLowerCase()));
    endDateInput.addEventListener('change', () => renderBuilds(buildSearchInput.value.toLowerCase()));

    uploadBtn.addEventListener('click', () => {
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
        progressFill.style.width = '0%';
        uploadBtn.disabled = true;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/files', true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressFill.style.width = percentComplete + '%';
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
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
                let errorMsg = 'Upload failed';
                try {
                    const err = JSON.parse(xhr.responseText);
                    errorMsg += ': ' + err.error;
                } catch (e) { }
                showToast(errorMsg, 'error');
                progressContainer.style.display = 'none';
            }
            uploadBtn.disabled = false;
        };

        xhr.onerror = () => {
            showToast('Network error occurred during upload.', 'error');
            progressContainer.style.display = 'none';
            uploadBtn.disabled = false;
        };

        xhr.send(formData);
    });

    async function loadBuilds() {
        buildsList.innerHTML = '<li style="color: var(--text-light)">Loading builds...</li>';
        try {
            const res = await fetch('/api/files');
            const data = await res.json();
            allBuilds = data.files || [];
            renderBuilds();
        } catch (e) {
            buildsList.innerHTML = '<li style="color: var(--danger)">Failed to load builds</li>';
        }
    }

    function renderBuilds(filter = '') {
        buildsList.innerHTML = '';

        // Sort: Pinned first, then by date descending
        const sortedBuilds = [...allBuilds].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.uploadTime) - new Date(a.uploadTime);
        });

        const filtered = sortedBuilds.filter(file => {
            const searchStr = `${file.key} ${file.eventName}`.toLowerCase();
            const matchesSearch = searchStr.includes(filter);

            const fileDate = new Date(file.uploadTime);
            let matchesDate = true;

            if (startDateInput.value) {
                const start = new Date(startDateInput.value);
                start.setHours(0, 0, 0, 0);
                if (fileDate < start) matchesDate = false;
            }
            if (endDateInput.value) {
                const end = new Date(endDateInput.value);
                end.setHours(23, 59, 59, 999);
                if (fileDate > end) matchesDate = false;
            }

            return matchesSearch && matchesDate;
        });

        if (filtered.length === 0) {
            buildsList.innerHTML = `<li style="color: var(--text-light)">${allBuilds.length === 0 ? 'No builds found' : 'No matching results'}</li>`;
            return;
        }

        filtered.forEach(file => {
            const li = document.createElement('li');
            if (file.pinned) li.classList.add('pinned-item');

            const sizeInMB = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
            const uploadTime = formatDateTime(file.uploadTime);
            const lastDownload = formatDateTime(file.lastDownloaded);

            li.innerHTML = `
                <div class="build-info">
                    <a href="#" class="build-name" onclick="event.preventDefault(); window.downloadFile('${file.key}')">
                        ${file.pinned ? '<span class="pin-icon">Γ£┬ö</span> ' : ''}${file.key}
                    </a>
                    <span class="build-meta">
                        <strong>Event:</strong> ${file.eventName}<br>
                        <strong>Info:</strong> ${file.buildInfo}<br>
                        <strong>Uploaded:</strong> ${uploadTime} (${sizeInMB})<br>
                        <strong>Downloads:</strong> ${file.downloadCount} | <strong>Last:</strong> ${lastDownload}
                    </span>
                </div>
                <div class="item-actions">
                    ${isAdminUser ? `
                        <button class="pin-btn icon-btn ${file.pinned ? 'active' : ''}" onclick="window.togglePinFile('${file.key}')" title="${file.pinned ? 'Unpin' : 'Pin'}">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        </button>
                        <button class="delete-btn icon-btn" onclick="window.deleteFile('${file.key}')" title="Delete">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    ` : ''}
                </div>
            `;
            buildsList.appendChild(li);
        });
    }

    window.togglePinFile = async (key) => {
        try {
            const res = await fetch(`/api/files/${encodeURIComponent(key)}/pin`, { method: 'POST' });
            if (res.ok) {
                loadBuilds();
                showToast('Pin status updated');
            }
        } catch (e) {
            showToast('Failed to update pin', 'error');
        }
    };

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
                setTimeout(loadBuilds, 1000);
            } else {
                showToast('Invalid password or access denied', 'error');
            }
        } catch (error) {
            showToast('Error requesting download link', 'error');
        }
    };

    window.deleteFile = async (key) => {
        const password = await showModal({
            title: 'Confirm Delete',
            message: `Enter the Delete Password to remove "${key}":`,
            showInput: true,
            confirmText: 'Delete Forever',
            placeholder: 'Delete password'
        });

        if (!password) return;

        try {
            const res = await fetch('/api/files/' + encodeURIComponent(key), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deletePassword: password })
            });

            if (res.ok) {
                showToast('Build deleted successfully', 'success');
                loadBuilds();
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to delete build', 'error');
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

            // Sort: Pinned first
            const sortedLinks = (data.links || []).sort((a, b) => (a.pinned === b.pinned) ? 0 : a.pinned ? -1 : 1);

            linksList.innerHTML = '';
            if (sortedLinks.length === 0) {
                linksList.innerHTML = '<li style="color: var(--text-light)">No links found</li>';
                return;
            }

            sortedLinks.forEach(link => {
                const li = document.createElement('li');
                if (link.pinned) li.classList.add('pinned-item');

                li.innerHTML = `
                    <div class="build-info">
                        <a href="${link.url || '#'}" target="_blank" class="build-name" onclick="window.accessLink(event, '${link.id}', '${link.url}')">
                            ${link.pinned ? '<span class="pin-icon">Γ£┬ö</span> ' : ''}${link.title}
                        </a>
                    </div>
                    <div class="item-actions">
                        ${isAdminUser ? `
                            <button class="pin-btn icon-btn ${link.pinned ? 'active' : ''}" onclick="window.togglePinLink('${link.id}')" title="${link.pinned ? 'Unpin' : 'Pin'}">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                            </button>
                            <button class="delete-btn icon-btn" onclick="window.deleteLink('${link.id}', '${link.title}')" title="Delete">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        ` : ''}
                    </div>
                `;
                linksList.appendChild(li);
            });
        } catch (e) {
            linksList.innerHTML = '<li style="color: var(--danger)">Failed to load links</li>';
        }
    }

    window.togglePinLink = async (id) => {
        try {
            const res = await fetch(`/api/links/${id}/pin`, { method: 'POST' });
            if (res.ok) {
                loadLinks();
                showToast('Pin status updated');
            }
        } catch (e) {
            showToast('Failed to update pin', 'error');
        }
    };

    window.accessLink = async (event, id, directUrl) => {
        if (isAdminUser && directUrl) return;
        event.preventDefault();

        const password = await showModal({
            title: 'Access Web Link',
            message: `Enter password to view this link.`,
            showInput: true,
            confirmText: 'Access'
        });

        if (!password) return;

        try {
            const res = await fetch(`/api/links/${id}/access`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                const data = await res.json();
                window.open(data.url, '_blank');
            } else {
                showToast('Invalid password', 'error');
            }
        } catch (e) {
            showToast('Error accessing link', 'error');
        }
    };

    window.deleteLink = async (id, title) => {
        const password = await showModal({
            title: 'Confirm Delete Link',
            message: `Enter the Delete Password to remove "${title}":`,
            showInput: true,
            confirmText: 'Delete Link',
            placeholder: 'Delete password'
        });

        if (!password) return;

        try {
            const res = await fetch('/api/links/' + id, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deletePassword: password })
            });

            if (res.ok) {
                showToast('Link removed', 'success');
                loadLinks();
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to remove link', 'error');
            }
        } catch (e) {
            showToast('Network error', 'error');
        }
    };

    // Initial Load
    checkAuth();
});
