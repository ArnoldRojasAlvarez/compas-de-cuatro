// T-004: configuracion de Playwright para el e2e de deriva (ver
// docs/tickets/T-004-pista-y-entrada.md, seccion "Tests"). Es el unico
// paquete del repo con un e2e: por eso vive junto a la app, no en la raiz.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // La prueba de deriva deja correr 60s de audio real: con el arranque del
  // servidor de Vite y margen, 120s por test alcanza sin ser exagerado.
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // Un navegador real necesita audio habilitado y no necesita gesto del
    // usuario para arrancar un AudioContext en el Chromium que usa
    // Playwright si se lanza con esta flag: si no, start() quedaria
    // 'suspended' y ctx.currentTime no avanzaria, y la prueba de deriva no
    // mediria nada real. `--mute-audio` corta solo la salida a los parlantes:
    // el grafo de audio y su reloj siguen corriendo igual, y correr el e2e no
    // hace sonar nada en la maquina.
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
