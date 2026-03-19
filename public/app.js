document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const passwordInput = document.getElementById('password-input');
    const adminPanel = document.getElementById('admin-panel');

    let isAdminUser = false;

    // Check auth status
    fetch('/api/auth/status')
        .then(res => res.json())
        .then(data => {
            isAdminUser = data.isAdmin;
            updateUI();
        });

    loginBtn.addEventListener('click', async () => {
        const password = passwordInput.value;
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
            isAdminUser = true;
            passwordInput.value = '';
            updateUI();
        } else {
            alert('Invalid password');
        }
    });

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        isAdminUser = false;
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

    // Handles files
    const uploadBtn = document.getElementById('upload-file-btn');
    const fileInput = document.getElementById('file-input');
    const uploadStatus = document.getElementById('upload-status');
    const buildsList = document.getElementById('builds-list');
    const refreshBuildsBtn = document.getElementById('refresh-builds-btn');

    refreshBuildsBtn.addEventListener('click', loadBuilds);

    uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
            alert('Please select a .zip file first');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        uploadStatus.textContent = 'Uploading to AWS... Please wait.';
        uploadBtn.disabled = true;

        try {
            const res = await fetch('/api/files', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                uploadStatus.textContent = 'Uploaded successfully!';
                fileInput.value = '';
                loadBuilds();
            } else {
                const err = await res.json();
                uploadStatus.textContent = 'Failed: ' + err.error;
            }
        } catch (error) {
            uploadStatus.textContent = 'Network error occurred.';
        } finally {
            uploadBtn.disabled = false;
        }
    });

    async function loadBuilds() {
        buildsList.innerHTML = '<li>Loading...</li>';
        const res = await fetch('/api/files');
        const data = await res.json();

        buildsList.innerHTML = '';
        if (data.files.length === 0) {
            buildsList.innerHTML = '<li>No builds found</li>';
            return;
        }

        data.files.forEach(file => {
            const li = document.createElement('li');
            const sizeInMB = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
            const date = new Date(file.lastModified).toLocaleDateString();

            li.innerHTML = `
                <div>
                    <strong><a href="#" onclick="downloadFile('${file.key}'); return false;">${file.key}</a></strong>
                    <br><small>${sizeInMB} - ${date}</small>
                </div>
                ${isAdminUser ? `<button class="delete-btn" onclick="deleteFile('${file.key}')">Remove</button>` : ''}
            `;
            buildsList.appendChild(li);
        });
    }

    window.downloadFile = async (key) => {
        let password = "";
        if (!isAdminUser) {
            password = prompt(`Please enter the password to download: ${key}`);
            if (password === null) return; // Cancelled
        }

        try {
            const res = await fetch('/api/files/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, password })
            });

            if (res.ok) {
                const data = await res.json();
                // Create a temporary link and trigger download
                const a = document.createElement('a');
                a.href = data.url;
                a.download = key;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } else {
                alert('Invalid password or error generating link');
            }
        } catch (error) {
            alert('An error occurred during download request.');
        }
    };

    window.deleteFile = async (key) => {
        if (!confirm('Are you sure you want to delete this build from AWS S3?')) return;

        const res = await fetch('/api/files/' + encodeURIComponent(key), {
            method: 'DELETE'
        });

        if (res.ok) {
            loadBuilds();
        } else {
            alert('Failed to delete build');
        }
    };

    // Handles Weblinks
    const linksList = document.getElementById('links-list');
    const addLinkBtn = document.getElementById('add-link-btn');
    const linkTitle = document.getElementById('link-title');
    const linkUrl = document.getElementById('link-url');

    addLinkBtn.addEventListener('click', async () => {
        if (!linkTitle.value || !linkUrl.value) {
            alert('Please enter both title and URL');
            return;
        }

        const res = await fetch('/api/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: linkTitle.value, url: linkUrl.value })
        });

        if (res.ok) {
            linkTitle.value = '';
            linkUrl.value = '';
            loadLinks();
        } else {
            alert('Failed to add link');
        }
    });

    async function loadLinks() {
        const res = await fetch('/api/links');
        const data = await res.json();

        linksList.innerHTML = '';
        if (data.links.length === 0) {
            linksList.innerHTML = '<li>No links added yet</li>';
            return;
        }

        data.links.forEach(link => {
            const li = document.createElement('li');
            li.innerHTML = `
                <a href="${link.url}" target="_blank">${link.title}</a>
                ${isAdminUser ? `<button class="delete-btn" onclick="deleteLink('${link.id}')">Remove</button>` : ''}
            `;
            linksList.appendChild(li);
        });
    }

    window.deleteLink = async (id) => {
        if (!confirm('Are you sure you want to delete this link?')) return;

        const res = await fetch('/api/links/' + id, {
            method: 'DELETE'
        });

        if (res.ok) {
            loadLinks();
        } else {
            alert('Failed to delete link');
        }
    };

    // Initial Load
    loadBuilds();
    loadLinks();
});
