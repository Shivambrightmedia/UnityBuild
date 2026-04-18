require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

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

const DATA_FILE = path.join(__dirname, 'data.json');
const S3_DATA_KEY = 'persistent_data.json';

// --- Initialize Local Data File ---
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ links: [], buildsMetadata: {}, assetsMetadata: {} }));
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
        console.log('Data backed up to S3');
    } catch (err) {
        console.error('Error backing up to S3:', err.message);
    }
}

loadDataFromS3();

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
const upload = multer({ storage: storage, limits: { fileSize: 3000 * 1024 * 1024 } });

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
    res.json({ isAdmin: !!req.session.isAdmin });
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
            type: type
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

        const files = (result.Contents || [])
            .filter(file => file.Key !== S3_DATA_KEY)
            .map(file => {
                const meta = buildsMetadata[file.Key] || assetsMetadata[file.Key] || {};
                const type = buildsMetadata[file.Key] ? 'build' : (assetsMetadata[file.Key] ? 'asset' : 'build');
                return {
                    key: file.Key,
                    size: file.Size,
                    lastModified: file.LastModified,
                    eventName: meta.eventName || 'N/A',
                    buildInfo: meta.buildInfo || 'N/A',
                    uploadTime: meta.uploadTime || file.LastModified,
                    downloadCount: meta.downloadCount || 0,
                    lastDownloaded: meta.lastDownloaded || null,
                    pinned: meta.pinned || false,
                    type: type
                };
            });

        res.json({ files });
    } catch (err) {
        console.error('S3 List Error:', err);
        res.status(500).json({ error: 'Failed to fetch files' });
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

app.post('/api/files/download', async (req, res) => {
    try {
        const { key, password } = req.body;
        const data = JSON.parse(fs.readFileSync(DATA_FILE));

        let fileType = 'build';
        if (data.assetsMetadata && data.assetsMetadata[key]) fileType = 'asset';

        const requiredPassword = fileType === 'asset' ? ASSET_PASSWORD : ACCESS_PASSWORD;

        if (!req.session.isAdmin && password !== requiredPassword) {
            return res.status(401).json({ error: 'Invalid access password' });
        }
        const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
        const url = await getSignedUrl(s3, getCommand, { expiresIn: 300 });

        let metaSource = 'buildsMetadata';
        if (data.assetsMetadata && data.assetsMetadata[key]) metaSource = 'assetsMetadata';

        if (!data[metaSource][key]) {
            data[metaSource][key] = { eventName: 'N/A', buildInfo: 'N/A', uploadTime: new Date().toISOString() };
        }
        data[metaSource][key].downloadCount = (data[metaSource][key].downloadCount || 0) + 1;
        data[metaSource][key].lastDownloaded = new Date().toISOString();

        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        await saveDataToS3(data);
        res.json({ url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate link' });
    }
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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
