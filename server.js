const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const app = express();

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

// Global variables to store server info
let SERVER_INFO = {
    port: null,
    serveDir: SERVE_DIR,
    networkIPs: [],
    hostname: os.hostname()
};

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get server information
app.get('/api/server-info', (req, res) => {
    res.json(SERVER_INFO);
});

// API endpoint to get directory contents
app.get('/api/browse/*', (req, res) => {
    const requestPath = req.params[0] || '';
    const fullPath = path.join(SERVE_DIR, requestPath);

    // Security check
    if (!fullPath.startsWith(SERVE_DIR)) {
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
    const fullPath = path.join(SERVE_DIR, requestPath);

    // Security check
    if (!fullPath.startsWith(SERVE_DIR)) {
        return res.status(403).send('Forbidden');
    }

    if (!fs.existsSync(fullPath)) {
        return res.status(404).send('File not found');
    }

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
        return res.status(400).send('Cannot download directory');
    }

    res.sendFile(fullPath);
});

// Fallback route - serve the main UI for any unmatched routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

        // Update server info
        SERVER_INFO.port = PORT;
        SERVER_INFO.networkIPs = networkIPs;

        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 File Server Started!');
            console.log(`📍 Serving directory: ${SERVE_DIR}`);
            console.log(`💻 Hostname: ${SERVER_INFO.hostname}`);
            console.log('');
            console.log('🌐 Server URLs:');
            console.log(`   Local:    http://localhost:${PORT}`);
            console.log(`   Local:    http://127.0.0.1:${PORT}`);

            if (networkIPs.length > 0) {
                networkIPs.forEach(ip => {
                    console.log(`   Network:  http://${ip.address}:${PORT} (${ip.interface})`);
                });
                console.log('');
                console.log('📱 Network access: Others on your network can access using the Network URLs above');
            } else {
                console.log('');
                console.log('⚠️  No network interfaces found - server only accessible locally');
            }

            if (specifiedPort && PORT !== specifiedPort) {
                console.log(`⚠️  Port ${specifiedPort} was busy, using ${PORT} instead`);
            }
            console.log('');
            console.log('Usage:');
            console.log('  node server.js --port 8080 --dir ./my-folder');
            console.log('  node server.js -p 3000 -d /path/to/files');
            console.log('');
            console.log('Press Ctrl+C to stop the server');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

startServer();