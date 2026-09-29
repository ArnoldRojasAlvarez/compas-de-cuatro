import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Los paquetes del monorepo se resuelven desde su fuente, no desde su `dist`
// compilada: asi `npm run dev` y `npm run build` nunca usan codigo viejo ni
// fallan porque falte compilar (la trampa de la dist, ver HANDOFF).
const fuente = (paquete: string): string =>
  fileURLToPath(new URL(`../../packages/${paquete}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@tetra/core': fuente('core'),
      '@tetra/audio': fuente('audio'),
      '@tetra/engine': fuente('engine'),
      '@tetra/storage': fuente('storage'),
    },
  },
});
