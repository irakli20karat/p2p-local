# File Server - Network File Sharing

A simple, secure file server that allows you to share files across your network. Others can access your files through their web browsers using your network IP address.

## 🚀 Quick Start

### Option 1: Using Node.js
```bash
npm install
npm start
```

### Option 2: Using the Windows Executable
Double-click `start-server.bat` or run:
```cmd
start-server.bat
```

### Option 3: Using Pre-built Executables
Run the appropriate executable from the `serve` folder:
- Windows: `serve/FileServer-windows.exe`
- Linux: `serve/FileServer-linux`
- macOS: `serve/FileServer-macos`

## 🌐 Network Access

### Same Network (LAN) Access
Once started, the server will display local network URLs like:
```
📱 Same Network Access (LAN):
   http://192.168.1.100:6488 (Wi-Fi)
   http://10.0.0.50:6488 (Ethernet)
```

**Share these URLs with others on your network** - they can access your files immediately.

### Cross-Network (Internet) Access
The server also detects your external IP for internet access:
```
🌍 Cross-Network Access (Internet):
   External IP: 203.0.113.45
   Potential URL: http://203.0.113.45:6488
```

**Three ways to enable cross-network access:**

#### Option 1: Tunneling Services (Easiest)
```bash
# Interactive setup
npm run tunnel

# Or directly use:
npm run ngrok        # Recommended - provides HTTPS
npm run localtunnel  # Simple HTTP tunnel
```

#### Option 2: Router Port Forwarding (Most Reliable)
1. Open your router admin panel (usually 192.168.1.1)
2. Find "Port Forwarding" settings
3. Forward external port 6488 to your computer's local IP:6488
4. Share the external URL shown by the server

#### Option 3: Manual Tunneling
```bash
npx ngrok http 6488
# or
npx localtunnel --port 6488
```

## ⚙️ Configuration Options

### Custom Port
```bash
node server.js --port 8080
# or
node server.js -p 8080
```

### Custom Directory
```bash
node server.js --dir ./my-files
# or
node server.js -d /path/to/files
```

### Combined Options
```bash
node server.js --port 3000 --dir ./shared-folder
```

## 🔒 Security Notes

- The server binds to `0.0.0.0` to allow network access
- Only files in the specified directory are accessible
- Path traversal attacks are prevented
- No authentication is required (suitable for trusted networks)

## 🛠️ Firewall Configuration

If others can't access your server:

### Windows Firewall
1. Open Windows Defender Firewall
2. Click "Allow an app or feature through Windows Defender Firewall"
3. Click "Change Settings" → "Allow another app"
4. Browse to `node.exe` or your executable
5. Check both "Private" and "Public" networks

### Alternative: Allow Port
1. Open Windows Defender Firewall
2. Click "Advanced settings"
3. Right-click "Inbound Rules" → "New Rule"
4. Select "Port" → "TCP" → enter your port number (default: 6488)
5. Allow the connection for all profiles

## 📱 Features

- **Web-based interface** - No software installation needed for clients
- **Directory browsing** - Navigate folders like a file explorer
- **File downloads** - Click any file to download it
- **Responsive design** - Works on desktop, tablet, and mobile
- **Network discovery** - Automatically detects and displays network IPs
- **Cross-platform** - Works on Windows, macOS, and Linux

## 🎯 Use Cases

- Share files during meetings or presentations
- Transfer files between devices on the same network
- Provide temporary file access to colleagues
- Share media files with family/friends on home network
- Quick file distribution in office environments

## 🔧 Troubleshooting

### "No network interfaces found"
- Check your network connection
- Ensure you're connected to Wi-Fi or Ethernet
- Try restarting the server after connecting to network

### Others can't access the server
- Verify they're on the same network
- Check firewall settings (see above)
- Try a different port if the current one is blocked
- Ensure antivirus isn't blocking the connection

### Port already in use
The server will automatically find an available port and display it in the console.

## 📋 Requirements

- Node.js 14+ (if running from source)
- Network connection for network access
- Modern web browser for clients