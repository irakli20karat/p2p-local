#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🌐 File Server Tunneling Setup');
console.log('===============================');
console.log('');

// Check if package.json exists to determine the port
let defaultPort = 6488;
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    // Try to extract port from scripts if available
    const startScript = packageJson.scripts?.start || packageJson.scripts?.dev;
    if (startScript && startScript.includes('--port')) {
        const portMatch = startScript.match(/--port\s+(\d+)/);
        if (portMatch) {
            defaultPort = parseInt(portMatch[1]);
        }
    }
} catch (error) {
    // Use default port
}

const port = process.argv[2] || defaultPort;

console.log(`📍 Setting up tunnel for port ${port}`);
console.log('');

console.log('🔧 Available tunneling options:');
console.log('');

console.log('1. ngrok (Recommended)');
console.log('   - Provides HTTPS URLs');
console.log('   - More reliable and faster');
console.log('   - Command: npx ngrok http ' + port);
console.log('');

console.log('2. localtunnel');
console.log('   - Free and simple');
console.log('   - HTTP only');
console.log('   - Command: npx localtunnel --port ' + port);
console.log('');

console.log('3. Manual Router Setup');
console.log('   - Most reliable for permanent access');
console.log('   - Requires router configuration');
console.log('   - See server output for instructions');
console.log('');

// Interactive selection
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Choose an option (1-3) or press Enter for ngrok: ', (answer) => {
    const choice = answer.trim() || '1';
    
    switch (choice) {
        case '1':
            console.log('');
            console.log('🚀 Starting ngrok tunnel...');
            console.log('');
            const ngrok = spawn('npx', ['ngrok', 'http', port.toString()], {
                stdio: 'inherit',
                shell: true
            });
            
            ngrok.on('error', (error) => {
                console.error('❌ Failed to start ngrok:', error.message);
                console.log('💡 Try installing ngrok: npm install -g ngrok');
                process.exit(1);
            });
            
            ngrok.on('close', (code) => {
                console.log(`ngrok exited with code ${code}`);
            });
            break;
            
        case '2':
            console.log('');
            console.log('🚀 Starting localtunnel...');
            console.log('');
            const lt = spawn('npx', ['localtunnel', '--port', port.toString()], {
                stdio: 'inherit',
                shell: true
            });
            
            lt.on('error', (error) => {
                console.error('❌ Failed to start localtunnel:', error.message);
                console.log('💡 Try: npm install -g localtunnel');
                process.exit(1);
            });
            
            lt.on('close', (code) => {
                console.log(`localtunnel exited with code ${code}`);
            });
            break;
            
        case '3':
            console.log('');
            console.log('🔧 Manual Router Setup Instructions:');
            console.log('');
            console.log('1. Find your router IP (usually 192.168.1.1 or 192.168.0.1)');
            console.log('2. Open router admin panel in your browser');
            console.log('3. Look for "Port Forwarding" or "Virtual Server" settings');
            console.log(`4. Add rule: External Port ${port} → Internal Port ${port}`);
            console.log('5. Set internal IP to your computer\'s local IP');
            console.log('6. Enable the rule and save settings');
            console.log('');
            console.log('💡 Your file server will show the external IP when started');
            break;
            
        default:
            console.log('❌ Invalid option');
            break;
    }
    
    rl.close();
});