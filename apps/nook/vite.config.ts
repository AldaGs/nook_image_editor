import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // /home is a plain page about the app (Google's sign-in branding links to it).
  build: { rollupOptions: { input: { main: 'index.html', home: 'home/index.html' } } },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Nook',
        short_name: 'Nook',
        description: 'Design boards and social posts on the go, with layers that go straight into animation.',
        theme_color: '#18181b',
        background_color: '#1c1c1f',
        display: 'standalone',
        orientation: 'any',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // Precache the CanvasKit wasm (~7 MB) so the app opens offline.
        globPatterns: ['**/*.{js,css,html,svg,wasm,woff2}'],
        // AI stays off the install: the ONNX runtime and models download only when AI is used.
        globIgnores: ['**/ort*.{wasm,mjs}', '**/ort.*.mjs', 'models/**'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // The home, privacy and terms pages are their own pages, not the app.
        navigateFallbackDenylist: [/^\/home/, /^\/privacy/, /^\/terms/],
      },
    }),
  ],
});
