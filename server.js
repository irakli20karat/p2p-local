const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server);
const activeDownloads = new Map();
const connectedPeers = new Map();
const hostViewerSocketIds = new Set();

function normalizeClientAddress(address) {
    return (address || '').replace(/^::ffff:/i, '').replace(/^::1$/, '127.0.0.1');
}

function isHostAddress(address) {
    const normalizedAddress = normalizeClientAddress(address);
    return normalizedAddress === '127.0.0.1' ||
        SERVER_INFO.networkIPs.some(ip => normalizeClientAddress(ip.address) === normalizedAddress);
}

function publishDownloadPeers(filePath) {
    const peers = Array.from(activeDownloads.values())
        .filter(download => download.filePath === filePath)
        .map(download => {
            const elapsedSeconds = Math.max((Date.now() - download.startedAt) / 1000, 0.1);
            const speed = download.bytesSent / elapsedSeconds;
            const remainingBytes = Math.max(download.fileSize - download.bytesSent, 0);
            return {
                id: download.id,
                ip: download.ip,
                deviceName: download.deviceName,
                nickname: download.nickname,
                percent: download.fileSize ? Math.min(download.bytesSent / download.fileSize * 100, 100) : 0,
                downloaded: Math.min(download.bytesSent, download.fileSize),
                left: Math.max(download.fileSize - download.bytesSent, 0),
                speed,
                eta: speed > 0 ? remainingBytes / speed : null,
                elapsed: elapsedSeconds
            };
        });
    hostViewerSocketIds.forEach(socketId => {
        io.to(socketId).emit('download-peers', { filePath, peers });
    });
}

function buildTrackerSnapshot(now = Date.now()) {
    const downloads = Array.from(activeDownloads.values()).map(download => {
        const elapsed = Math.max((now - download.startedAt) / 1000, 0.1);
        const speed = download.currentSpeed || 0;
        const left = Math.max(download.fileSize - download.bytesSent, 0);
        return {
            id: download.id,
            filePath: download.filePath,
            fileName: path.basename(download.filePath),
            ip: download.ip,
            deviceName: download.deviceName,
            nickname: download.nickname,
            percent: download.fileSize ? Math.min(download.bytesSent / download.fileSize * 100, 100) : 0,
            downloaded: Math.min(download.bytesSent, download.fileSize),
            left,
            speed,
            speedHistory: download.speedHistory || [],
            eta: speed > 0 ? left / speed : null,
            elapsed
        };
    });
    return {
        downloads,
        totalSpeed: downloads.reduce((total, download) => total + download.speed, 0)
    };
}

function publishTrackerSnapshot() {
    const now = Date.now();
    activeDownloads.forEach(download => {
        const previousTime = download.lastSampleAt || download.startedAt;
        const previousBytes = download.lastSampleBytes || 0;
        const sampleSeconds = Math.max((now - previousTime) / 1000, 0.001);
        download.currentSpeed = Math.max(download.bytesSent - previousBytes, 0) / sampleSeconds;
        download.lastSampleAt = now;
        download.lastSampleBytes = download.bytesSent;
        download.speedHistory = download.speedHistory || [];
        download.speedHistory.push({ time: now, speed: download.currentSpeed });
        if (download.speedHistory.length > 60) download.speedHistory.shift();
    });
    const snapshot = buildTrackerSnapshot(now);
    hostViewerSocketIds.forEach(socketId => {
        io.to(socketId).emit('tracker-update', snapshot);
    });
}

// Parse command line arguments
const args = process.argv.slice(2);
let specifiedPort = null;
let specifiedDir = null;

args.forEach((arg, index) => {
    if (arg === '--port' || arg === '-p') {
        specifiedPort = parseInt(args[index + 1]);
    } else if (arg === '--dir' || arg === '-d') {
        specifiedDir = args[index + 1];
    }
});

// Default values
const DEFAULT_PORT = 6488;
const MAX_PORT_ATTEMPTS = 100;

// Check if running as pkg executable
const isPackaged = process.pkg !== undefined;
const defaultServeDir = isPackaged ?
    path.join(process.cwd(), 'serve') :
    path.join(__dirname, 'serve');

const SERVE_DIR = specifiedDir ? path.resolve(specifiedDir) : defaultServeDir;

function isWithinDirectory(directory, target) {
    const relativePath = path.relative(directory, target);
    return relativePath === '' || (
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

function resolveServedPath(requestPath) {
    const rootPath = path.resolve(SERVE_DIR);
    const targetPath = path.resolve(rootPath, requestPath);
    if (!isWithinDirectory(rootPath, targetPath)) return null;

    if (!fs.existsSync(targetPath)) return targetPath;
    try {
        const realRoot = fs.realpathSync(rootPath);
        const realTarget = fs.realpathSync(targetPath);
        return isWithinDirectory(realRoot, realTarget) ? realTarget : null;
    } catch (error) {
        return null;
    }
}

// Function to get network IP addresses
function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (!iface.internal && iface.family === 'IPv4') {
                ips.push({
                    address: iface.address,
                    interface: name
                });
            }
        }
    }

    return ips;
}

function printAccessBox(lines) {
    const title = 'FILE SERVER ACCESS';
    const width = Math.max(title.length, ...lines.map(line => line.length));
    const border = `─`.repeat(width + 2);
    const printRow = text => console.log(`│ ${text.padEnd(width)} │`);

    console.log(`┌${border}┐`);
    printRow(title);
    console.log(`├${border}┤`);
    lines.forEach(printRow);
    console.log(`└${border}┘`);
}

// Function to get external IP address
async function getExternalIP() {
    const services = [
        'https://api.ipify.org',
        'https://ipv4.icanhazip.com',
        'https://checkip.amazonaws.com'
    ];

    for (const service of services) {
        try {
            const response = await new Promise((resolve, reject) => {
                const req = https.get(service, { timeout: 5000 }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve({ data: data.trim(), status: res.statusCode }));
                });
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Timeout'));
                });
            });

            if (response.status === 200 && response.data) {
                return response.data;
            }
        } catch (error) {
            continue; // Try next service
        }
    }
    return null;
}

// Function to check if port is available
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
            server.once('close', () => resolve(true));
            server.close();
        });
        server.on('error', () => resolve(false));
    });
}

// Function to find available port
async function findAvailablePort(startPort) {
    for (let port = startPort; port < startPort + MAX_PORT_ATTEMPTS; port++) {
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(`No available port found after checking ${MAX_PORT_ATTEMPTS} ports starting from ${startPort}`);
}

// Function to generate secure username based on IP
function generateSecureUsername(ip, displayName) {
    // Create a hash of the IP address
    const hash = crypto.createHash('sha256').update(ip).digest('hex');
    // Take first 4 characters of the hash
    const ipCode = hash.substring(0, 4).toUpperCase();
    // Clean the display name (remove special characters, limit length)
    const cleanName = displayName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 15) || 'User';
    return `@${ipCode}-${cleanName}`;
}

// Global variables to store server info
let SERVER_INFO = {
    port: null,
    serveDir: SERVE_DIR,
    networkIPs: [],
    externalIP: null,
    hostname: os.hostname()
};

// Serve the built React UI first, then other public assets (including the legacy page).
const UI_DIR = path.join(__dirname, 'public', 'ui');
app.use(express.static(UI_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get server information
app.get('/api/server-info', (req, res) => {
    res.json(SERVER_INFO);
});

// API endpoint to get directory contents
app.get('/api/browse/*', (req, res) => {
    const requestPath = req.params[0] || '';
    const fullPath = resolveServedPath(requestPath);
    if (!fullPath) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Path not found' });
    }

    const stat = fs.statSync(fullPath);

    if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
    }

    try {
        const files = fs.readdirSync(fullPath);
        const fileList = files.map(file => {
            const filePath = path.join(fullPath, file);
            const fileStat = fs.statSync(filePath);

            return {
                name: file,
                isDirectory: fileStat.isDirectory(),
                size: fileStat.size,
                modified: fileStat.mtime.toISOString()
            };
        });

        res.json({
            path: requestPath,
            files: fileList,
            parent: requestPath ? path.dirname(requestPath) : null
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

// File download endpoint
app.get('/download/*', (req, res) => {
    const requestPath = req.params[0] || '';
    const fullPath = resolveServedPath(requestPath);
    if (!fullPath) {
        return res.status(403).send('Forbidden');
    }

    if (!fs.existsSync(fullPath)) {
        return res.status(404).send('File not found');
    }

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
        return res.status(400).send('Cannot download directory');
    }

    const downloadId = crypto.randomUUID();
    const download = {
        id: downloadId,
        peerId: typeof req.query.peerId === 'string' ? req.query.peerId : '',
        filePath: requestPath.replace(/\\/g, '/'),
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        deviceName: connectedPeers.get(req.query.peerId)?.deviceName || 'Unknown device',
        nickname: connectedPeers.get(req.query.peerId)?.nickname || '',
        fileSize: stat.size,
        bytesSent: 0,
        speedHistory: [],
        startedAt: Date.now()
    };
    activeDownloads.set(downloadId, download);
    publishDownloadPeers(download.filePath);
    const progressTimer = setInterval(() => publishDownloadPeers(download.filePath), 1000);

    const stream = fs.createReadStream(fullPath);
    stream.on('data', chunk => {
        download.bytesSent += chunk.length;
    });
    stream.on('error', () => {
        if (!res.headersSent) res.status(500);
        res.end();
    });
    res.on('close', () => {
        clearInterval(progressTimer);
        activeDownloads.delete(downloadId);
        publishDownloadPeers(download.filePath);
    });
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(fullPath))}`);
    stream.pipe(res);
});

// Fallback route - serve the main UI for any unmatched routes
app.get('*', (req, res) => {
    const uiIndex = path.join(UI_DIR, 'index.html');
    res.sendFile(fs.existsSync(uiIndex) ? uiIndex : path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {
    try {
        // Check if serve directory exists
        if (!fs.existsSync(SERVE_DIR)) {
            console.log(`📁 Creating directory: ${SERVE_DIR}`);
            fs.mkdirSync(SERVE_DIR, { recursive: true });
        }

        // Create public directory if it doesn't exist
        const publicDir = path.join(__dirname, 'public');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }

        const startPort = specifiedPort || DEFAULT_PORT;
        const PORT = await findAvailablePort(startPort);
        const networkIPs = getNetworkIPs();
        
        // Get external IP for cross-network access
        console.log('🔍 Detecting external IP address...');
        const externalIP = await getExternalIP();

        // Update server info
        SERVER_INFO.port = PORT;
        SERVER_INFO.networkIPs = networkIPs;
        SERVER_INFO.externalIP = externalIP;

        // Socket.IO chat functionality
        const connectedUsers = new Map();
        
        io.on('connection', (socket) => {
            const clientIP = normalizeClientAddress(socket.handshake.address || socket.conn.remoteAddress || 'unknown');
            console.log(`👤 User connected: ${socket.id} from ${clientIP}`);
            if (isHostAddress(clientIP)) hostViewerSocketIds.add(socket.id);
            const canViewTracker = hostViewerSocketIds.has(socket.id);
            socket.emit('tracker-access', canViewTracker);
            if (canViewTracker) socket.emit('tracker-update', buildTrackerSnapshot());
            connectedPeers.set(socket.id, { deviceName: 'Unknown device', nickname: '' });
            socket.on('peer-info', (data) => {
                const peer = connectedPeers.get(socket.id);
                if (peer && data && typeof data.deviceName === 'string') {
                    peer.deviceName = data.deviceName.slice(0, 80);
                    activeDownloads.forEach(download => {
                        if (download.peerId === socket.id) {
                            download.deviceName = peer.deviceName;
                            publishDownloadPeers(download.filePath);
                        }
                    });
                }
            });
            const activePaths = new Set(Array.from(activeDownloads.values(), download => download.filePath));
            if (hostViewerSocketIds.has(socket.id)) activePaths.forEach(filePath => {
                const peers = Array.from(activeDownloads.values())
                    .filter(download => download.filePath === filePath)
                    .map(download => {
                        const elapsed = Math.max((Date.now() - download.startedAt) / 1000, 0.1);
                        const speed = download.bytesSent / elapsed;
                        return { id: download.id, ip: download.ip, deviceName: download.deviceName, nickname: download.nickname, percent: download.fileSize ? Math.min(download.bytesSent / download.fileSize * 100, 100) : 0, downloaded: Math.min(download.bytesSent, download.fileSize), left: Math.max(download.fileSize - download.bytesSent, 0), speed, eta: speed ? Math.max(download.fileSize - download.bytesSent, 0) / speed : null, elapsed };
                    });
                socket.emit('download-peers', { filePath, peers });
            });

            socket.on('join-chat', (displayName) => {
                // Generate secure username based on IP and display name
                const secureUsername = generateSecureUsername(clientIP, displayName || 'User');
                const peer = connectedPeers.get(socket.id);
                if (peer) peer.nickname = String(displayName || '').trim().slice(0, 20);
                activeDownloads.forEach(download => {
                    if (download.peerId === socket.id) {
                        download.nickname = peer?.nickname || '';
                        publishDownloadPeers(download.filePath);
                    }
                });
                
                const user = {
                    id: socket.id,
                    username: secureUsername,
                    displayName: displayName || 'User',
                    ip: clientIP,
                    joinedAt: new Date()
                };
                connectedUsers.set(socket.id, user);
                
                // Send the secure username back to the client
                socket.emit('username-assigned', secureUsername);
                
                // Notify all users about new user
                io.emit('user-joined', {
                    user: { username: secureUsername, displayName: user.displayName },
                    totalUsers: connectedUsers.size
                });
                
                // Send current user list to new user
                const userList = Array.from(connectedUsers.values()).map(u => ({
                    username: u.username,
                    displayName: u.displayName
                }));
                socket.emit('users-list', userList);
            });
            
            socket.on('chat-message', (data) => {
                const user = connectedUsers.get(socket.id);
                if (user) {
                    const message = {
                        id: Date.now(),
                        username: user.username,
                        message: data.message,
                        timestamp: new Date()
                    };
                    io.emit('chat-message', message);
                }
            });
            
            socket.on('disconnect', () => {
                hostViewerSocketIds.delete(socket.id);
                connectedPeers.delete(socket.id);
                const user = connectedUsers.get(socket.id);
                if (user) {
                    connectedUsers.delete(socket.id);
                    io.emit('user-left', {
                        user: { 
                            username: user.username, 
                            displayName: user.displayName 
                        },
                        totalUsers: connectedUsers.size
                    });
                    console.log(`👤 User disconnected: ${user.username} (${user.displayName})`);
                }
            });
        });

        setInterval(publishTrackerSnapshot, 1000);
        server.listen(PORT, '0.0.0.0', () => {
            console.log('File Server Started');
            console.log(`Host: ${SERVER_INFO.hostname}`);
            console.log(`Serving: ${SERVE_DIR}`);
            console.log('');
            printAccessBox([
                ...networkIPs.map(ip => `LAN  http://${ip.address}:${PORT}  (${ip.interface})`),
                ...(networkIPs.length ? [] : ['LAN  No IPv4 address detected']),
                externalIP ? `External  http://${externalIP}:${PORT}` : 'External  IP could not be detected',
                ...(externalIP ? ['External access may require router port forwarding.'] : [])
            ]);

            console.log('');
            console.log(`Local address: http://localhost:${PORT}`);
            console.log('Check that the firewall allows this port for LAN devices.');

            if (specifiedPort && PORT !== specifiedPort) {
                console.log(`⚠️  Port ${specifiedPort} was busy, using ${PORT} instead`);
            }
            console.log('');
            console.log('📋 Usage Examples:');
            console.log('  node server.js --port 8080 --dir ./my-folder');
            console.log('  node server.js -p 3000 -d /path/to/files');
            console.log('');
            console.log('🛑 Press Ctrl+C to stop the server');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

startServer();
