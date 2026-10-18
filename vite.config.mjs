import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: path.resolve(rootDir, 'frontend'),
    plugins: [react()],
    resolve: {
        alias: { '@': path.resolve(rootDir, 'frontend/src') }
    },
    build: {
        outDir: path.resolve(rootDir, 'public/ui'),
        emptyOutDir: true
    },
    server: {
        host: '0.0.0.0',
        proxy: {
            '/api': 'http://localhost:6488',
            '/download': 'http://localhost:6488',
            '/socket.io': { target: 'http://localhost:6488', ws: true }
        }
    }
});
