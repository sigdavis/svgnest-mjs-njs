import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  base: './',
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    host: true,
    fs: { allow: ['.', '../result', '/nix/store'], },
  },
  build: {
    target: 'esnext',
  },
});
