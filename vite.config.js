import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages のリポジトリ名に合わせて変更してください
  // 例: リポジトリが https://github.com/yourusername/webar-viewer の場合
  //     base: '/webar-viewer/'
  // ローカル開発時は '/' のままで問題ありません
  base: process.env.VITE_BASE_PATH || '/',

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },

  server: {
    port: 5173,
    // HTTPS is required for WebXR on real devices
    // For local testing with a real device, use: npx vite --https
    https: false,
    host: true, // Allow access from local network (e.g., phone on same Wi-Fi)
  },
});
