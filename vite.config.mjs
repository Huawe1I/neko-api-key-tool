import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: `${(env.PUBLIC_URL || '').replace(/\/$/, '')}/`,
    envPrefix: ['VITE_', 'REACT_APP_'],
    build: {
      outDir: 'build',
      sourcemap: false,
    },
  };
});
