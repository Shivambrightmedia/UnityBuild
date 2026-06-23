require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { OAuth2Client } = require('google-auth-library');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const UAParser = require('ua-parser-js');
const nodemailer = require('nodemailer');
const readline = require('readline');
const dns = require('dns');

// Force IPv4 because Render's free tier has broken IPv6 outbound
dns.setDefaultResultOrder('ipv4first');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret123',
    resave: false,
    saveUninitialized: false
}));

const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DELETE_PASSWORD = process.env.DELETE_PASSWORD;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'viewer';
const ASSET_PASSWORD = process.env.ASSET_PASSWORD || 'asset123';

// --- Email via Brevo HTTP API (bypasses Render's SMTP port blocking) ---
async function sendEmail({ to, subject, textContent }) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.SMTP_EMAIL || 'noreply@360brightmedia.com';
    if (!apiKey) return;

    const payload = {
        sender: { name: '360BrightMedia', email: senderEmail },
        to: to.map(email => ({ email })),
        subject: subject,
        textContent: textContent
    };

    try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const errBody = await res.text();
            console.error('Brevo API error:', res.status, errBody);
        } else {
            console.log('Email sent successfully via Brevo API');
        }
    } catch (err) {
        console.error('Failed to send email via Brevo:', err.message);
    }
}

const DATA_FILE = path.join(__dirname, 'data.json');
const S3_DATA_KEY = 'persistent_data.json';
const ANALYTICS_FILE = path.join(__dirname, 'analytics.jsonl');
const S3_ANALYTICS_KEY = 'persistent_analytics.jsonl';

// --- Initialize Local Data File ---
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ links: [], buildsMetadata: {}, assetsMetadata: {}, employees: [] }));
}
if (!fs.existsSync(ANALYTICS_FILE)) {
    fs.writeFileSync(ANALYTICS_FILE, '');
}

// --- S3 Persistence Helpers ---
async function loadDataFromS3() {
    try {
        console.log('Attempting to sync data from S3...');
        const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: S3_DATA_KEY });
        const response = await s3.send(command);
        const dataStr = await response.Body.transformToString();
        fs.writeFileSync(DATA_FILE, dataStr);
        console.log('Data successfully synced from S3');
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            console.log('No persistent data found on S3');
        } else {
            console.error('S3 Sync Error:', err.message);
        }
    }

    try {
        const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: S3_ANALYTICS_KEY });
        const response = await s3.send(command);
        const dataStr = await response.Body.transformToString();
        fs.writeFileSync(ANALYTICS_FILE, dataStr);
        console.log('Analytics data synced from S3');
    } catch (err) {
        if (err.name !== 'NoSuchKey') console.error('S3 Analytics Sync Error:', err.message);
    }
}

async function saveDataToS3(data) {
    try {
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: S3_DATA_KEY,
            Body: JSON.stringify(data, null, 2),
            ContentType: 'application/json'
        });
        await s3.send(command);
    } catch (err) {
        console.error('Error backing up to S3:', err.message);
    }
}

async function saveAnalyticsToS3() {
    try {
        if (!fs.existsSync(ANALYTICS_FILE)) return;
        const fileStream = fs.createReadStream(ANALYTICS_FILE);
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: S3_ANALYTICS_KEY,
            Body: fileStream,
            ContentType: 'application/jsonlines'
        });
        await s3.send(command);
    } catch (err) {
        console.error('Error backing up analytics to S3:', err.message);
    }
}

loadDataFromS3().then(() => {
    // Migration logic for old downloadLogs
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        let migratedAny = false;
        const processMeta = (metaObj) => {
            if (!metaObj) return;
            Object.keys(metaObj).forEach(key => {
                if (metaObj[key].downloadLogs && metaObj[key].downloadLogs.length > 0) {
                    metaObj[key].downloadLogs.forEach(log => {
                        const newLog = { buildKey: key, ...log };
                        fs.appendFileSync(ANALYTICS_FILE, JSON.stringify(newLog) + '\n');
                    });
                    delete metaObj[key].downloadLogs;
                    migratedAny = true;
                }
            });
        };
        processMeta(data.buildsMetadata);
        processMeta(data.assetsMetadata);
        if (migratedAny) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
            saveDataToS3(data);
            saveAnalyticsToS3();
            console.log('Migrated old download logs to analytics.jsonl');
        }
    } catch (e) {
        console.error('Migration error:', e);
    }
});

const requireAuth = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

// --- Multer Configuration ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage, limits: { fileSize: 10000 * 1024 * 1024 } });

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

app.get('/api/auth/status', (req, res) => {
    res.json({
        isAdmin: !!req.session.isAdmin,
        userEmail: req.session.userEmail || null,
        clientId: GOOGLE_CLIENT_ID
    });
});

app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        req.session.userEmail = payload.email;
        res.json({ success: true, email: payload.email });
    } catch (err) {
        console.error('Google Auth Error:', err);
        res.status(401).json({ success: false, error: 'Invalid Google Token' });
    }
});

app.get('/api/aws-info', requireAuth, (req, res) => {
    res.json({
        bucket: BUCKET_NAME,
        region: process.env.AWS_REGION || 'us-east-1'
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.post('/api/files', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { eventName, buildInfo } = req.body;
        const fileName = req.file.filename;
        const filePath = req.file.path;

        const fileStream = fs.createReadStream(filePath);

        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: fileStream,
            ContentType: 'application/zip'
        };

        await s3.send(new PutObjectCommand(uploadParams));
        fs.unlinkSync(filePath);

        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        const type = req.body.type || 'build';
        const metadataKey = type === 'asset' ? 'assetsMetadata' : 'buildsMetadata';

        if (!data[metadataKey]) data[metadataKey] = {};

        data[metadataKey][fileName] = {
            eventName: eventName || 'N/A',
            buildInfo: buildInfo || 'N/A',
            uploadTime: new Date().toISOString(),
            downloadCount: 0,
            lastDownloaded: null,
            pinned: false,
            assignedEmails: [],
            type: type,
            version: '1.0'
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);

        res.json({ success: true, fileName });
    } catch (err) {
        console.error('Upload Error:', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
});

app.get('/api/files', async (req, res) => {
    try {
        if (!BUCKET_NAME) return res.json({ files: [] });

        const result = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME }));
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        const buildsMetadata = data.buildsMetadata || {};
        const assetsMetadata = data.assetsMetadata || {};

        let files = (result.Contents || [])
            .filter(file => file.Key !== S3_DATA_KEY && file.Key !== S3_ANALYTICS_KEY)
            .map(file => {
                const meta = buildsMetadata[file.Key] || assetsMetadata[file.Key] || {};
                const type = buildsMetadata[file.Key] ? 'build' : (assetsMetadata[file.Key] ? 'asset' : 'build');
                const assignedEmails = meta.assignedEmails || [];
                const hasAccess = req.session.isAdmin || (req.session.userEmail && assignedEmails.includes(req.session.userEmail));

                const out = {
                    key: file.Key,
                    size: file.Size,
                    lastModified: file.LastModified,
                    eventName: meta.eventName || 'N/A',
                    buildInfo: meta.buildInfo || 'N/A',
                    uploadTime: meta.uploadTime || file.LastModified,
                    downloadCount: meta.downloadCount || 0,
                    lastDownloaded: meta.lastDownloaded || null,
                    pinned: meta.pinned || false,
                    type: type,
                    version: meta.version || '1.0',
                    hasAccess: !!hasAccess
                };
                if (req.session.isAdmin) {
                    out.assignedEmails = assignedEmails;
                }
                return out;
            });
        if (!req.session.isAdmin && req.session.userEmail) {
            files = files.filter(f => f.hasAccess);
        }

        res.json({ files });
    } catch (err) {
        console.error('S3 List Error:', err);
        res.status(500).json({ error: 'Failed to fetch files' });
    }
});

// --- Update Build Version ---
app.post('/api/files/:key/update-version', requireAuth, upload.single('file'), async (req, res) => {
    try {
        const { key } = req.params;
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        let metaSource = 'buildsMetadata';
        if (data.assetsMetadata && data.assetsMetadata[key]) metaSource = 'assetsMetadata';
        else if (!data.buildsMetadata[key]) metaSource = 'buildsMetadata';

        const existingMeta = data[metaSource][key];
        if (!existingMeta) return res.status(404).json({ error: 'File not found' });

        // Increment version
        const currentVersion = parseFloat(existingMeta.version || '1.0');
        const newVersion = (currentVersion + 1).toFixed(1);

        // Delete old file from S3
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));

        // Upload new file to S3
        const fileName = req.file.filename;
        const filePath = req.file.path;
        const fileStream = fs.createReadStream(filePath);

        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: fileStream,
            ContentType: 'application/zip'
        };

        await s3.send(new PutObjectCommand(uploadParams));
        fs.unlinkSync(filePath);

        // Update metadata with new version
        delete data[metaSource][key];
        data[metaSource][fileName] = {
            eventName: existingMeta.eventName,
            buildInfo: existingMeta.buildInfo,
            uploadTime: new Date().toISOString(),
            downloadCount: 0,
            lastDownloaded: null,
            pinned: existingMeta.pinned,
            assignedEmails: existingMeta.assignedEmails || [],
            assignmentDetails: existingMeta.assignmentDetails || {},
            assignmentExpirations: existingMeta.assignmentExpirations || {},
            type: existingMeta.type,
            version: newVersion
        };

        if (fs.existsSync(ANALYTICS_FILE)) {
            const lines = fs.readFileSync(ANALYTICS_FILE, 'utf-8').split('\n');
            const newLines = lines.map(line => {
                if (!line.trim()) return line;
                try {
                    const log = JSON.parse(line);
                    if (log.buildKey === key) {
                        log.buildKey = fileName;
                        return JSON.stringify(log);
                    }
                } catch(e) {}
                return line;
            });
            fs.writeFileSync(ANALYTICS_FILE, newLines.join('\n'));
            saveAnalyticsToS3(); // Backup migrated analytics
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);

        res.json({ success: true, fileName, newVersion });
    } catch (err) {
        console.error('Update Version Error:', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Update failed: ' + err.message });
    }
});

// --- NEW: Toggle Pin for Files ---
app.post('/api/files/:key/pin', requireAuth, async (req, res) => {
    try {
        const { key } = req.params;
        const data = JSON.parse(fs.readFileSync(DATA_FILE));

        let metaSource = 'buildsMetadata';
        if (data.assetsMetadata && data.assetsMetadata[key]) metaSource = 'assetsMetadata';
        else if (!data.buildsMetadata[key]) metaSource = 'buildsMetadata';

        if (!data[metaSource][key]) {
            data[metaSource][key] = { eventName: 'N/A', buildInfo: 'N/A', pinned: false };
        }

        data[metaSource][key].pinned = !data[metaSource][key].pinned;

        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);

        res.json({ success: true, pinned: data[metaSource][key].pinned });
    } catch (err) {
        res.status(500).json({ error: 'Failed to pin file' });
    }
});

// --- NEW: Assign Emails for Files ---
app.post('/api/files/:key/assign', requireAuth, async (req, res) => {
    try {
        const { key } = req.params;
        const { emails, duration } = req.body; // array of strings and duration
        const data = JSON.parse(fs.readFileSync(DATA_FILE));

        let metaSource = 'buildsMetadata';
        if (data.assetsMetadata && data.assetsMetadata[key]) metaSource = 'assetsMetadata';
        else if (!data.buildsMetadata[key]) metaSource = 'buildsMetadata';

        if (!data[metaSource][key]) return res.status(404).json({ error: 'File not found' });

        const newEmails = emails.map(e => e.trim().toLowerCase()).filter(e => e);

        if (!data[metaSource][key].assignmentDetails) data[metaSource][key].assignmentDetails = {};
        if (!data[metaSource][key].assignmentExpirations) data[metaSource][key].assignmentExpirations = {};

        const now = new Date();
        let expiryDateStr = null;
        if (duration && duration !== 'no_limit') {
            const days = parseInt(duration, 10);
            if (!isNaN(days)) {
                const expiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
                expiryDateStr = expiry.toISOString();
            }
        }

        const nowStr = now.toISOString();
        const newlyAssigned = [];

        newEmails.forEach(email => {
            if (!data[metaSource][key].assignmentDetails[email]) {
                data[metaSource][key].assignmentDetails[email] = nowStr;
                newlyAssigned.push(email);
            }
            if (expiryDateStr) {
                data[metaSource][key].assignmentExpirations[email] = expiryDateStr;
            } else {
                delete data[metaSource][key].assignmentExpirations[email];
            }
        });

        const oldEmails = Object.keys(data[metaSource][key].assignmentDetails);
        oldEmails.forEach(email => {
            if (!newEmails.includes(email)) {
                delete data[metaSource][key].assignmentDetails[email];
                delete data[metaSource][key].assignmentExpirations[email];
            }
        });

        data[metaSource][key].assignedEmails = newEmails;

        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);

        if (newlyAssigned.length > 0 && process.env.BREVO_API_KEY) {
            const buildName = data[metaSource][key].eventName || key;
            const appUrl = `${req.protocol}://${req.get('host')}`;
            
            let timeLimitStr = '';
            if (duration && duration !== 'no_limit') {
                const days = parseInt(duration, 10);
                if (days === 1) timeLimitStr = ' Please download within 1 day.';
                else if (days === 7) timeLimitStr = ' Please download within 1 week.';
                else if (days > 1) timeLimitStr = ` Please download within ${days} days.`;
            }

            sendEmail({
                to: newlyAssigned,
                subject: `Assigned to Build: ${buildName}`,
                textContent: `You have been assigned to download the build: ${buildName}.\n\nYou can access it here: ${appUrl}\n\nDownload before the Event starts and best of luck for the event.${timeLimitStr}\n\nTeam 360BrightMedia`
            }).catch(err => console.error('Failed to send assignment emails:', err));
        }

        res.json({ success: true, assignedEmails: data[metaSource][key].assignedEmails });
    } catch (err) {
        res.status(500).json({ error: 'Failed to assign emails' });
    }
});

app.post('/api/files/download', async (req, res) => {
    try {
        const { key, password } = req.body;
        const data = JSON.parse(fs.readFileSync(DATA_FILE));

        let fileType = 'build';
        if (data.assetsMetadata && data.assetsMetadata[key]) fileType = 'asset';

        const requiredPassword = fileType === 'asset' ? ASSET_PASSWORD : ACCESS_PASSWORD;

        let metaSource = 'buildsMetadata';
        if (data.assetsMetadata && data.assetsMetadata[key]) metaSource = 'assetsMetadata';

        const assignedEmails = data[metaSource] && data[metaSource][key] ? (data[metaSource][key].assignedEmails || []) : [];
        const assignmentExpirations = data[metaSource] && data[metaSource][key] ? (data[metaSource][key].assignmentExpirations || {}) : {};
        const isPasswordValid = password && password === requiredPassword;
        let isEmailAssigned = req.session.userEmail && assignedEmails.includes(req.session.userEmail);
        let isExpired = false;

        if (isEmailAssigned && assignmentExpirations[req.session.userEmail]) {
            const expiryDate = new Date(assignmentExpirations[req.session.userEmail]);
            if (new Date() > expiryDate) {
                isEmailAssigned = false;
                isExpired = true;
            }
        }

        if (!req.session.isAdmin) {
            if (!req.session.userEmail) {
                return res.status(401).json({ error: 'Please login with Google to download' });
            }
            if (isExpired && !isPasswordValid) {
                return res.status(403).json({ error: 'Your access to this file has expired' });
            }
            if (!isEmailAssigned && !isPasswordValid) {
                return res.status(403).json({ error: 'Not assigned and invalid password' });
            }
        }
        const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
        const url = await getSignedUrl(s3, getCommand, { expiresIn: 300 });

        if (!data[metaSource][key]) {
            data[metaSource][key] = { eventName: 'N/A', buildInfo: 'N/A', uploadTime: new Date().toISOString() };
        }
        data[metaSource][key].downloadCount = (data[metaSource][key].downloadCount || 0) + 1;
        data[metaSource][key].lastDownloaded = new Date().toISOString();
        const ua = new UAParser(req.headers['user-agent']);
        const browser = ua.getBrowser();
        const os = ua.getOS();
        const device = ua.getDevice();

        const deviceStr = device.type ? `${device.vendor || ''} ${device.type}`.trim() : 'Desktop/Laptop';
        const osStr = os.name ? `${os.name} ${os.version || ''}`.trim() : 'Unknown OS';
        const downloaderEmail = req.session.userEmail || (req.session.isAdmin ? 'Admin' : 'Anonymous');

        let authMethod = 'Unknown';
        if (req.session.isAdmin) authMethod = 'Admin';
        else if (isEmailAssigned) authMethod = 'Assigned';
        else if (isPasswordValid) authMethod = 'Password';

        const newLog = {
            buildKey: key,
            email: downloaderEmail,
            date: new Date().toISOString(),
            device: deviceStr,
            os: osStr,
            browser: `${browser.name || 'Unknown'} ${browser.version || ''}`.trim(),
            authMethod: authMethod
        };
        fs.appendFileSync(ANALYTICS_FILE, JSON.stringify(newLog) + '\n');

        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);
        saveAnalyticsToS3(); // Backup analytics async
        res.json({ url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate link' });
    }
});

app.get('/api/files/:key/analytics', requireAuth, async (req, res) => {
    const { key } = req.params;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));

    let metaSource = 'buildsMetadata';
    if (data.assetsMetadata && data.assetsMetadata[key]) metaSource = 'assetsMetadata';
    else if (!data.buildsMetadata[key]) metaSource = 'buildsMetadata';

    const fileData = data[metaSource][key];
    if (!fileData) return res.status(404).json({ error: 'File not found' });

    const downloadLogs = [];
    if (fs.existsSync(ANALYTICS_FILE)) {
        const fileStream = fs.createReadStream(ANALYTICS_FILE);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const log = JSON.parse(line);
                if (log.buildKey === key) downloadLogs.push(log);
            } catch (e) {}
        }
    }

    res.json({
        assignmentDetails: fileData.assignmentDetails || {},
        downloadLogs: downloadLogs
    });
});

app.get('/api/analytics/all', requireAuth, async (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));

    let allAssignments = [];
    let allDownloads = [];

    const processMetadata = (metaObj) => {
        if (!metaObj) return;
        Object.keys(metaObj).forEach(key => {
            const fileData = metaObj[key];
            if (fileData.assignmentDetails) {
                Object.keys(fileData.assignmentDetails).forEach(email => {
                    allAssignments.push({
                        buildKey: key,
                        email: email,
                        date: fileData.assignmentDetails[email]
                    });
                });
            }
        });
    };

    processMetadata(data.buildsMetadata);
    processMetadata(data.assetsMetadata);

    if (fs.existsSync(ANALYTICS_FILE)) {
        const fileStream = fs.createReadStream(ANALYTICS_FILE);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const log = JSON.parse(line);
                allDownloads.push(log);
            } catch (e) {}
        }
    }

    // Sort descending by date
    allAssignments.sort((a, b) => new Date(b.date) - new Date(a.date));
    allDownloads.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ allAssignments, allDownloads });
});

app.delete('/api/files/:key', requireAuth, async (req, res) => {
    try {
        const { key } = req.params;
        const { deletePassword } = req.body;
        if (deletePassword !== DELETE_PASSWORD) return res.status(401).json({ error: 'Invalid delete password' });
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
        const data = JSON.parse(fs.readFileSync(DATA_FILE));

        if (data.buildsMetadata && data.buildsMetadata[key]) delete data.buildsMetadata[key];
        if (data.assetsMetadata && data.assetsMetadata[key]) delete data.assetsMetadata[key];

        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

app.get('/api/links', (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    const safeLinks = (data.links || []).map(link => ({
        id: link.id,
        title: link.title,
        pinned: link.pinned || false,
        url: req.session.isAdmin ? link.url : null
    }));
    res.json({ links: safeLinks });
});

// --- NEW: Toggle Pin for Links ---
app.post('/api/links/:id/pin', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        const link = (data.links || []).find(l => l.id === id);

        if (link) {
            link.pinned = !link.pinned;
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
            await saveDataToS3(data);
            res.json({ success: true, pinned: link.pinned });
        } else {
            res.status(404).json({ error: 'Link not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to pin link' });
    }
});

app.post('/api/links/:id/access', (req, res) => {
    const { password } = req.body;
    const { id } = req.params;
    if (!req.session.isAdmin && password !== ACCESS_PASSWORD) return res.status(401).json({ error: 'Invalid access password' });
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    const link = (data.links || []).find(l => l.id === id);
    if (link) res.json({ url: link.url });
    else res.status(404).json({ error: 'Link not found' });
});

app.post('/api/links', requireAuth, async (req, res) => {
    const { title, url } = req.body;
    if (!title || !url) return res.status(400).json({ error: 'Title and URL required' });
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    const newLink = { id: Date.now().toString(), title, url, pinned: false };
    data.links.push(newLink);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    await saveDataToS3(data);
    res.json({ success: true, link: newLink });
});

app.delete('/api/links/:id', requireAuth, async (req, res) => {
    const { deletePassword } = req.body;
    if (deletePassword !== DELETE_PASSWORD) return res.status(401).json({ error: 'Invalid delete password' });
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    data.links = data.links.filter(link => link.id !== req.params.id);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    await saveDataToS3(data);
    res.json({ success: true });
});

// --- Employee Directory ---
app.get('/api/employees', requireAuth, (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    res.json({ employees: data.employees || [] });
});

app.post('/api/employees', requireAuth, async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@') || !email.includes('.com')) {
        return res.status(400).json({ error: 'Valid email required (@ and .com)' });
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    if (!data.employees) data.employees = [];
    const normalized = email.trim().toLowerCase();
    if (!data.employees.includes(normalized)) {
        data.employees.push(normalized);
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);
    }
    res.json({ success: true, employees: data.employees });
});

app.delete('/api/employees/:email', requireAuth, async (req, res) => {
    const { email } = req.params;
    const { deletePassword } = req.body;
    if (deletePassword !== DELETE_PASSWORD) return res.status(401).json({ error: 'Invalid delete password' });
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    if (!data.employees) data.employees = [];
    data.employees = data.employees.filter(e => e !== email.toLowerCase());
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    await saveDataToS3(data);
    res.json({ success: true, employees: data.employees });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
