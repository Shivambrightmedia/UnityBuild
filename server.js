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

const DATA_FILE = path.join(__dirname, 'data.json');

// Ensure data.json exists with the correct structure
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ links: [], buildsMetadata: {} }));
} else {
    const currentData = JSON.parse(fs.readFileSync(DATA_FILE));
    if (!currentData.buildsMetadata) {
        currentData.buildsMetadata = {};
        fs.writeFileSync(DATA_FILE, JSON.stringify(currentData, null, 2));
    }
}

const requireAuth = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

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

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/files', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { eventName, buildInfo } = req.body;
        const fileName = `${Date.now()}-${req.file.originalname}`;

        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        };

        await s3.send(new PutObjectCommand(uploadParams));

        // Save metadata
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        data.buildsMetadata[fileName] = {
            eventName: eventName || 'N/A',
            buildInfo: buildInfo || 'N/A'
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

        res.json({ success: true, fileName });
    } catch (err) {
        console.error('S3 Upload Error:', err);
        res.status(500).json({ error: 'Failed to upload to S3' });
    }
});

app.get('/api/files', async (req, res) => {
    try {
        if (!BUCKET_NAME) return res.json({ files: [] });

        const result = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME }));
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        const buildsMetadata = data.buildsMetadata || {};

        const files = (result.Contents || []).map(file => ({
            key: file.Key,
            size: file.Size,
            lastModified: file.LastModified,
            eventName: buildsMetadata[file.Key]?.eventName || 'N/A',
            buildInfo: buildsMetadata[file.Key]?.buildInfo || 'N/A'
        }));

        res.json({ files });
    } catch (err) {
        console.error('S3 List Error:', err);
        res.status(500).json({ error: 'Failed to fetch files' });
    }
});

app.post('/api/files/download', async (req, res) => {
    try {
        const { key, password } = req.body;

        if (!req.session.isAdmin && password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
        const url = await getSignedUrl(s3, getCommand, { expiresIn: 300 });

        res.json({ url });
    } catch (err) {
        console.error('S3 Download URL Error:', err);
        res.status(500).json({ error: 'Failed to generate download link' });
    }
});

app.delete('/api/files/:key', requireAuth, async (req, res) => {
    try {
        const { key } = req.params;
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));

        // Remove metadata
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        if (data.buildsMetadata && data.buildsMetadata[key]) {
            delete data.buildsMetadata[key];
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        }

        res.json({ success: true });
    } catch (err) {
        console.error('S3 Delete Error:', err);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

app.get('/api/links', (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    res.json({ links: data.links || [] });
});

app.post('/api/links', requireAuth, (req, res) => {
    const { title, url } = req.body;
    if (!title || !url) return res.status(400).json({ error: 'Title and URL required' });

    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    const newLink = { id: Date.now().toString(), title, url };
    data.links.push(newLink);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    res.json({ success: true, link: newLink });
});

app.delete('/api/links/:id', requireAuth, (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    data.links = data.links.filter(link => link.id !== req.params.id);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
