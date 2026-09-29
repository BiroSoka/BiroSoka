import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Socket.IO traffic is proxied to the Node server on :3001,
// so the phone on your Wi-Fi only needs the Vite URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': 'http://localhost:3001',
    },
  },
  worker: { format: 'es' },
});
