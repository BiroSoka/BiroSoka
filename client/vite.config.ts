import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Socket.IO traffic is proxied to the Node server (default :3001, override with BIRO_SERVER),
// so the phone on your Wi-Fi only needs the Vite URL.
const SERVER = process.env.BIRO_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/api': SERVER,
    },
  },
  worker: { format: 'es' },
});
