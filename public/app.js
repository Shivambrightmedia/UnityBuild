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
    const buildsList = document.getElementById('files-list');
    const refreshFilesBtn = document.getElementById('refresh-files-btn');
    const viewTypeSelect = document.getElementById('view-type-select');
    const linksList = document.getElementById('links-list');
    const addLinkBtn = document.getElementById('add-link-btn');
    const linkTitle = document.getElementById('link-title');
    const linkUrl = document.getElementById('link-url');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('upload-progress-text');
    const fileSearchInput = document.getElementById('file-search');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const buildFilters = document.getElementById('build-filters');

    // Modal Elements
    const modal = document.getElementById('custom-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalInputContainer = document.getElementById('modal-input-container');
    const modalInput = document.getElementById('modal-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');

    // Drag & Drop Elements
    const dropOverlay = document.getElementById('drop-overlay');
    const buildDetailsModal = document.getElementById('build-details-modal');
    const droppedFileName = document.getElementById('dropped-file-name');
    const modalEventName = document.getElementById('modal-event-name');
    const modalBuildInfo = document.getElementById('modal-build-info');
    const buildModalCancelBtn = document.getElementById('build-modal-cancel-btn');
    const buildModalConfirmBtn = document.getElementById('build-modal-confirm-btn');

    // Update Version Modal Elements
    const updateVersionModal = document.getElementById('update-version-modal');
    const updateVersionHeader = document.getElementById('update-version-header');
    const updateVersionInfo = document.getElementById('update-version-info');
    const updateEventName = document.getElementById('update-event-name');
    const updateBuildInfo = document.getElementById('update-build-info');
    const updateFileInput = document.getElementById('update-file-input');
    const updateProgressContainer = document.getElementById('update-progress-container');
    const updateProgressFill = document.getElementById('update-progress-fill');
    const updateProgressText = document.getElementById('update-progress-text');
    const updateVersionCancelBtn = document.getElementById('update-version-cancel-btn');
    const updateVersionConfirmBtn = document.getElementById('update-version-confirm-btn');

    let currentUpdateKey = null;


    let isAdminUser = false;
    let modalResolve = null;
    let allFiles = [];

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
            loadAWSInfo();
        } else {
            loginBtn.style.display = 'inline-block';
            passwordInput.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
            adminPanel.style.display = 'none';
        }
        loadAllFiles();
        loadLinks();
    }

    async function loadAWSInfo() {
        const infoEl = document.getElementById('aws-info');
        if (!infoEl) return;
        try {
            const res = await fetch('/api/aws-info');
            const data = await res.json();
            infoEl.textContent = `${data.bucket} (${data.region})`;
        } catch (e) {
            infoEl.textContent = 'Error loading';
        }
    }

    // --- Builds Management ---
    refreshFilesBtn.addEventListener('click', loadAllFiles);

    viewTypeSelect.addEventListener('change', () => {
        renderFiles();
    });

    fileSearchInput.addEventListener('input', () => {
        renderFiles(fileSearchInput.value.toLowerCase());
    });

    startDateInput.addEventListener('change', () => {
        quickRangeSelect.value = 'all';
        renderFiles(fileSearchInput.value.toLowerCase());
    });
    endDateInput.addEventListener('change', () => {
        quickRangeSelect.value = 'all';
        renderFiles(fileSearchInput.value.toLowerCase());
    });

    // Quick Filter Range
    const quickRangeSelect = document.getElementById('quick-range-select');

    function toYMD(date) {
        if (!date) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    quickRangeSelect.addEventListener('change', () => {
        const range = quickRangeSelect.value;
        const now = new Date();
        let start = null;

        switch (range) {
            case 'today':
                start = new Date(now);
                start.setHours(0, 0, 0, 0);
                break;
            case 'week':
                const day = now.getDay();
                const diff = now.getDate() - day + (day === 0 ? -6 : 1);
                start = new Date(now);
                start.setDate(diff);
                start.setHours(0, 0, 0, 0);
                break;
            case 'month':
                start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                break;
            case '6month':
                start = new Date(now);
                start.setMonth(start.getMonth() - 6);
                start.setHours(0, 0, 0, 0);
                break;
            case 'year':
                start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 0, 0, 0, 0);
                break;
            case 'all':
            default:
                start = null;
                break;
        }

        startDateInput.value = toYMD(start);
        endDateInput.value = ''; // Clear end date for quick ranges

        renderFiles(fileSearchInput.value.toLowerCase());
    });

    function performUpload(file, eventName, buildInfo) {
        const formData = new FormData();

        let type = 'build';
        if (modal.style.display === 'flex') {
            // Unused in this context but keeping for safety
        }

        // Check for active upload source
        const buildModal = document.getElementById('build-details-modal');
        if (buildModal.style.display === 'flex') {
            type = document.querySelector('input[name="modal-upload-type"]:checked').value;
        } else {
            type = document.querySelector('input[name="upload-type"]:checked').value;
        }

        formData.append('file', file);
        formData.append('eventName', eventName);
        formData.append('buildInfo', buildInfo);
        formData.append('type', type);

        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '0% uploaded';
        uploadBtn.disabled = true;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/files', true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressFill.style.width = percentComplete + '%';
                progressText.textContent = `${Math.round(percentComplete)}% uploaded`;
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                progressFill.style.width = '100%';
                progressText.textContent = '100% uploaded';
                showToast('Build uploaded successfully!', 'success');
                fileInput.value = '';
                eventNameInput.value = '';
                buildInfoInput.value = '';
                modalEventName.value = '';
                modalBuildInfo.value = '';
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    progressFill.style.width = '0%';
                    progressText.textContent = '0% uploaded';
                }, 1000);
                loadAllFiles();
            } else {
                let errorMsg = 'Upload failed';
                try {
                    const err = JSON.parse(xhr.responseText);
                    errorMsg += ': ' + err.error;
                } catch (e) { }
                showToast(errorMsg, 'error');
                progressContainer.style.display = 'none';
                progressText.textContent = '0% uploaded';
            }
            uploadBtn.disabled = false;
        };

        xhr.onerror = () => {
            showToast('Network error occurred during upload.', 'error');
            progressContainer.style.display = 'none';
            progressText.textContent = '0% uploaded';
            uploadBtn.disabled = false;
        };

        xhr.send(formData);
    }

    uploadBtn.addEventListener('click', () => {
        const file = fileInput.files[0];
        if (!file) {
            showToast('Please select a .zip file first', 'error');
            return;
        }
        performUpload(file, eventNameInput.value, buildInfoInput.value);
    });

    // --- Drag and Drop Management ---
    let pendingFile = null;

    window.addEventListener('dragenter', (e) => {
        if (!isAdminUser) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            dropOverlay.classList.add('active');
        }
    });

    window.addEventListener('dragover', (e) => {
        if (!isAdminUser) return;
        e.preventDefault();
        e.stopPropagation();
    });

    dropOverlay.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropOverlay.classList.remove('active');
    });

    window.addEventListener('drop', (e) => {
        if (!isAdminUser) return;
        e.preventDefault();
        e.stopPropagation();
        dropOverlay.classList.remove('active');

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.name.toLowerCase().endsWith('.zip')) {
                pendingFile = file;
                openBuildDetailsModal(file.name);
            } else {
                showToast('Only ZIP folders/files are allowed', 'error');
            }
        }
    });

    function openBuildDetailsModal(fileName) {
        const header = document.getElementById('build-modal-header');
        header.textContent = `Upload Details: ${fileName}`;
        droppedFileName.textContent = `File: ${fileName}`;
        modalEventName.value = '';
        modalBuildInfo.value = '';
        buildDetailsModal.style.display = 'flex';
        setTimeout(() => modalEventName.focus(), 100);
    }

    buildModalCancelBtn.addEventListener('click', () => {
        buildDetailsModal.style.display = 'none';
        pendingFile = null;
    });

    buildModalConfirmBtn.addEventListener('click', () => {
        if (!pendingFile) return;

        const eventName = modalEventName.value.trim();
        const buildInfo = modalBuildInfo.value.trim();

        if (!eventName) {
            showToast('Event Name is required', 'error');
            return;
        }

        buildDetailsModal.style.display = 'none';
        performUpload(pendingFile, eventName, buildInfo);
        pendingFile = null;
    });


    async function loadAllFiles() {
        buildsList.innerHTML = '<li style="color: var(--text-light)">Loading...</li>';
        try {
            const res = await fetch('/api/files');
            const data = await res.json();
            allFiles = data.files || [];
            
            // Update stats
            updateStorageStats(allFiles);
            
            renderFiles();
        } catch (e) {
            buildsList.innerHTML = '<li style="color: var(--danger)">Failed to load</li>';
        }
    }

    function updateStorageStats(files) {
        const totalSizeBytes = files.reduce((acc, file) => acc + (file.size || 0), 0);
        const totalGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
        
        const storageEl = document.getElementById('total-storage');
        const filesEl = document.getElementById('total-files');
        
        if (storageEl) storageEl.textContent = `${totalGB} GB`;
        if (filesEl) filesEl.textContent = files.length;
    }

    function renderFiles(filter = '') {
        const type = viewTypeSelect.value;
        buildsList.innerHTML = '';

        const files = allFiles.filter(f => f.type === type);

        // Sort: Pinned first, then by date descending
        const sorted = [...files].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.uploadTime) - new Date(a.uploadTime);
        });

        const filtered = sorted.filter(file => {
            const searchStr = `${file.key} ${file.eventName}`.toLowerCase();
            const matchesSearch = searchStr.includes(filter);

            const fileDate = new Date(file.uploadTime);
            let matchesDate = true;

            if (startDateInput.value) {
                const [y, m, d] = startDateInput.value.split('-').map(Number);
                const start = new Date(y, m - 1, d, 0, 0, 0, 0);
                if (fileDate < start) matchesDate = false;
            }
            if (endDateInput.value) {
                const [y, m, d] = endDateInput.value.split('-').map(Number);
                const end = new Date(y, m - 1, d, 23, 59, 59, 999);
                if (fileDate > end) matchesDate = false;
            }

            return matchesSearch && matchesDate;
        });

        if (filtered.length === 0) {
            buildsList.innerHTML = `<li style="color: var(--text-light)">${files.length === 0 ? 'No files found' : 'No matching results'}</li>`;
            return;
        }

        filtered.forEach(file => {
            const li = document.createElement('li');
            if (file.pinned) li.classList.add('pinned-item');

            const sizeInMB = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
            const uploadTime = formatDateTime(file.uploadTime);

            const metaHtml = type === 'build' ? `
                <strong>Name:</strong> ${file.eventName}<br>
                <strong>Info:</strong> ${file.buildInfo}<br>
                <strong>Version:</strong> ${file.version || '1.0'}<br>
                <strong>Uploaded:</strong> ${uploadTime} (${sizeInMB})<br>
                <strong>Downloads:</strong> ${file.downloadCount} | <strong>Last:</strong> ${formatDateTime(file.lastDownloaded)}
            ` : `
                <strong>Category:</strong> ${file.eventName}<br>
                <strong>Info:</strong> ${file.buildInfo}<br>
                <strong>Stored:</strong> ${uploadTime} (${sizeInMB})
            `;

            li.innerHTML = `
                <div class="build-info">
                    <a href="#" class="build-name" onclick="event.preventDefault(); window.downloadFile('${file.key}')">
                        ${file.pinned ? '<span class="pin-icon">📍</span> ' : ''}${file.key}
                    </a>
                    <span class="build-meta">
                        ${metaHtml}
                    </span>
                </div>
                <div class="item-actions">
                    ${isAdminUser ? `
                        <button class="pin-btn icon-btn ${file.pinned ? 'active' : ''}" onclick="window.togglePinFile('${file.key}')" title="${file.pinned ? 'Unpin' : 'Pin'}">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        </button>
                        <div class="dropdown" style="position: relative; display: inline-block;">
                            <button class="menu-btn icon-btn" onclick="window.toggleMenu('${file.key}')" title="More options">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                            </button>
                            <div id="menu-${file.key}" class="dropdown-menu" style="display: none; position: absolute; right: 0; top: 100%; background: white; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; min-width: 150px;">
                                ${type === 'build' ? `
                                <button class="dropdown-item" onclick="window.openUpdateVersionModal('${file.key}', '${file.eventName}', '${file.buildInfo}')" style="width: 100%; padding: 8px 12px; text-align: left; border: none; background: none; cursor: pointer; font-size: 14px;">
                                    Update Version
                                </button>
                                ` : ''}
                                <button class="dropdown-item" onclick="window.deleteFile('${file.key}')" style="width: 100%; padding: 8px 12px; text-align: left; border: none; background: none; cursor: pointer; font-size: 14px; color: var(--danger);">
                                    Delete
                                </button>
                            </div>
                        </div>
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
                loadAllFiles();
                showToast('Pin status updated');
            }
        } catch (e) {
            showToast('Failed to update pin', 'error');
        }
    };

    window.downloadFile = async (key) => {
        const file = allFiles.find(f => f.key === key);
        const isAsset = file && file.type === 'asset';
        
        let password = "";
        if (!isAdminUser) {
            password = await showModal({
                title: isAsset ? 'Download Asset' : 'Download Build',
                message: isAsset ? `Enter Asset Password to download: ${key}` : `Enter Viewer Password to download: ${key}`,
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
                setTimeout(loadAllFiles, 1000);
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
                showToast('Deleted successfully', 'success');
                loadAllFiles();
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

    // --- Menu Toggle ---
    window.toggleMenu = (key) => {
        const menu = document.getElementById(`menu-${key}`);
        const isVisible = menu.style.display === 'block';
        
        // Close all other menus
        document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
        
        // Toggle current menu
        menu.style.display = isVisible ? 'none' : 'block';
    };

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
        }
    });

    // --- Update Version Modal ---
    window.openUpdateVersionModal = (key, eventName, buildInfo) => {
        currentUpdateKey = key;
        updateVersionHeader.textContent = `Update Version: ${key}`;
        updateVersionInfo.textContent = `Current: ${eventName} - ${buildInfo}`;
        updateEventName.value = eventName;
        updateBuildInfo.value = buildInfo;
        updateFileInput.value = '';
        updateVersionModal.style.display = 'flex';
        setTimeout(() => updateFileInput.focus(), 100);
        
        // Close the menu
        document.getElementById(`menu-${key}`).style.display = 'none';
    };

    updateVersionCancelBtn.addEventListener('click', () => {
        updateVersionModal.style.display = 'none';
        currentUpdateKey = null;
        updateFileInput.value = '';
    });

    updateVersionConfirmBtn.addEventListener('click', () => {
        const file = updateFileInput.files[0];
        if (!file) {
            showToast('Please select a .zip file first', 'error');
            return;
        }
        if (!currentUpdateKey) {
            showToast('No build selected for update', 'error');
            return;
        }

        performVersionUpdate(currentUpdateKey, file);
    });

    function performVersionUpdate(key, file) {
        const formData = new FormData();
        formData.append('file', file);

        updateProgressContainer.style.display = 'block';
        updateProgressFill.style.width = '0%';
        updateProgressText.textContent = '0% uploaded';
        updateVersionConfirmBtn.disabled = true;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/files/${encodeURIComponent(key)}/update-version`, true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                updateProgressFill.style.width = percentComplete + '%';
                updateProgressText.textContent = `${Math.round(percentComplete)}% uploaded`;
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                updateProgressFill.style.width = '100%';
                updateProgressText.textContent = '100% uploaded';
                const data = JSON.parse(xhr.responseText);
                showToast(`Updated to version ${data.newVersion}!`, 'success');
                updateFileInput.value = '';
                setTimeout(() => {
                    updateProgressContainer.style.display = 'none';
                    updateProgressFill.style.width = '0%';
                    updateProgressText.textContent = '0% uploaded';
                    updateVersionModal.style.display = 'none';
                    currentUpdateKey = null;
                }, 1000);
                loadAllFiles();
            } else {
                let errorMsg = 'Update failed';
                try {
                    const err = JSON.parse(xhr.responseText);
                    errorMsg += ': ' + err.error;
                } catch (e) { }
                showToast(errorMsg, 'error');
                updateProgressContainer.style.display = 'none';
                updateProgressText.textContent = '0% uploaded';
            }
            updateVersionConfirmBtn.disabled = false;
        };

        xhr.onerror = () => {
            showToast('Network error occurred during update.', 'error');
            updateProgressContainer.style.display = 'none';
            updateProgressText.textContent = '0% uploaded';
            updateVersionConfirmBtn.disabled = false;
        };

        xhr.send(formData);
    }

    // Initial Load
    checkAuth();
});
