import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The public address of the store, used in index.html for the canonical link, share image and
// structured data. Change it here (or set VITE_SITE_URL) when David's own domain is connected.
process.env.VITE_SITE_URL ??= 'https://david-store-web.vercel.app';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'logo.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Davo',
        short_name: 'Davo',
        description: 'Shop online in Ghana: phones, electronics, fashion, home and more.',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API responses are never served from the service worker cache: stock and prices must be live.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    // Use the shared package's TypeScript source directly; no build step needed in dev.
    alias: { '@david-store/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
