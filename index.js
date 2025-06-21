const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
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
  path.join(process.cwd(), 'serve') :  // Use current working directory when packaged
  path.join(__dirname, 'serve');       // Use script directory when running with node

const SERVE_DIR = specifiedDir ? path.resolve(specifiedDir) : defaultServeDir;

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

// Function to generate HTML directory listing
function generateDirectoryListing(dirPath, requestPath) {
  const files = fs.readdirSync(dirPath);
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Directory listing for ${requestPath}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 20px; }
        .info { background: #e3f2fd; padding: 10px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; color: #1976d2; }
        ul { list-style: none; padding: 0; }
        li { margin: 8px 0; padding: 8px; border-radius: 4px; transition: background 0.2s; }
        li:hover { background: #f0f0f0; }
        a { text-decoration: none; color: #0066cc; display: flex; align-items: center; }
        a:hover { text-decoration: underline; }
        .folder { color: #ff6600; font-weight: bold; }
        .file { color: #0066cc; }
        .icon { margin-right: 8px; font-size: 16px; }
        .size { margin-left: auto; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📂 Directory listing for ${requestPath}</h1>
        <div class="info">📍 Serving: ${SERVE_DIR}</div>
        <ul>
  `;

  // Add parent directory link if not at root
  if (requestPath !== '/') {
    const parentPath = path.dirname(requestPath);
    html += `<li><a href="${parentPath}" class="folder"><span class="icon">📁</span> ..</a></li>`;
  }

  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    const isDirectory = stat.isDirectory();
    const href = path.join(requestPath, file).replace(/\\/g, '/');
    
    let sizeInfo = '';
    if (!isDirectory) {
      const sizeInBytes = stat.size;
      const sizeInKB = (sizeInBytes / 1024).toFixed(1);
      sizeInfo = `<span class="size">${sizeInKB} KB</span>`;
    }
    
    if (isDirectory) {
      html += `<li><a href="${href}/" class="folder"><span class="icon">📁</span> ${file}/</a></li>`;
    } else {
      html += `<li><a href="${href}" class="file"><span class="icon">📄</span> ${file} ${sizeInfo}</a></li>`;
    }
  });

  html += `
        </ul>
      </div>
    </body>
    </html>
  `;
  
  return html;
}

// Handle directory browsing and file serving
app.get('*', (req, res) => {
  const requestPath = decodeURIComponent(req.path);
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
    // Show directory listing
    const html = generateDirectoryListing(fullPath, requestPath);
    res.send(html);
  } else {
    // Serve the file
    res.sendFile(fullPath);
  }
});

// Start server with port finding logic
async function startServer() {
  try {
    // Check if serve directory exists
    if (!fs.existsSync(SERVE_DIR)) {
      console.log(`📁 Creating directory: ${SERVE_DIR}`);
      fs.mkdirSync(SERVE_DIR, { recursive: true });
    }

    const startPort = specifiedPort || DEFAULT_PORT;
    const PORT = await findAvailablePort(startPort);
    
    app.listen(PORT, () => {
      console.log('🚀 File Server Started!');
      console.log(`📍 Serving directory: ${SERVE_DIR}`);
      console.log(`🌐 Server running on: http://localhost:${PORT}`);
      if (specifiedPort && PORT !== specifiedPort) {
        console.log(`⚠️  Port ${specifiedPort} was busy, using ${PORT} instead`);
      }
      console.log('');
      console.log('Usage:');
      console.log('  node index.js --port 8080 --dir ./my-folder');
      console.log('  node index.js -p 3000 -d /path/to/files');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
