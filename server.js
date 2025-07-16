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
            const clientIP = socket.handshake.address || socket.conn.remoteAddress || 'unknown';
            console.log(`👤 User connected: ${socket.id} from ${clientIP}`);
            
            socket.on('join-chat', (displayName) => {
                // Generate secure username based on IP and display name
                const secureUsername = generateSecureUsername(clientIP, displayName || 'User');
                
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

        server.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 File Server Started!');
            console.log(`📍 Serving directory: ${SERVE_DIR}`);
            console.log(`💻 Hostname: ${SERVER_INFO.hostname}`);
            console.log('');
            console.log('🌐 Local Access URLs:');
            console.log(`   http://localhost:${PORT}`);
            console.log(`   http://127.0.0.1:${PORT}`);

            if (networkIPs.length > 0) {
                console.log('');
                console.log('📱 Same Network Access (LAN):');
                networkIPs.forEach(ip => {
                    console.log(`   http://${ip.address}:${PORT} (${ip.interface})`);
                });
            }

            if (externalIP) {
                console.log('');
                console.log('🌍 Cross-Network Access (Internet):');
                console.log(`   External IP: ${externalIP}`);
                console.log(`   Potential URL: http://${externalIP}:${PORT}`);
                console.log('');
                console.log('⚠️  ROUTER SETUP REQUIRED for cross-network access:');
                console.log('   1. Open your router admin panel (usually 192.168.1.1 or 192.168.0.1)');
                console.log(`   2. Set up Port Forwarding: External Port ${PORT} → Internal IP ${networkIPs[0]?.address || 'YOUR_LOCAL_IP'}:${PORT}`);
                console.log('   3. Enable the port forwarding rule');
                console.log(`   4. Share this URL: http://${externalIP}:${PORT}`);
                console.log('');
                console.log('🔒 SECURITY WARNING:');
                console.log('   - This will expose your files to the entire internet');
                console.log('   - Only enable if you trust who will access it');
                console.log('   - Consider using a VPN or tunneling service instead');
            } else {
                console.log('');
                console.log('⚠️  Could not detect external IP address');
                console.log('💡 Check your internet connection for cross-network access');
            }

            console.log('');
            console.log('🔧 Alternative Cross-Network Solutions:');
            console.log('   - Use ngrok: npx ngrok http ' + PORT);
            console.log('   - Use localtunnel: npx localtunnel --port ' + PORT);
            console.log('   - Set up a VPN connection');

            if (networkIPs.length > 0) {
                console.log('');
                console.log('✅ Same network users can access immediately using LAN URLs above');
                console.log('💡 Make sure your firewall allows connections on port', PORT);
            }

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