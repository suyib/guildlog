import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import pkg from './package.json';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Not a secret: a public link shown in the sidebar (https only)
    __SUPPORT_URL__: JSON.stringify(/^https:\/\/\S+$/.test(process.env.SUPPORT_URL ?? '') ? process.env.SUPPORT_URL : ''),
  },
});
