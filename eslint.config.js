import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    // Los globs tienen que ser **/x/** : 'dist' a secas solo ignora el dist
    // de la raiz, no apps/web/dist ni packages/*/dist.
    ignores: [
      '**/dist/**',
      '**/.tsbuild/**',
      '**/node_modules/**',
      '**/.vite/**',
      '**/*.tsbuildinfo',
      // Worktrees de agentes en paralelo: son otras copias del repo, no se
      // lintean desde aca (cada agente corre su propio lint en su worktree).
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Scripts de generacion de fixtures (Node puro, ver
    // tools/generar-fixture-click.py y su equivalente en JS
    // tools/generar-fixture-mania-test.mjs de T-005): no forman parte del
    // build de ningun paquete, corren con `node` directo y usan los
    // globales del entorno Node, no los del navegador ni los de ningun
    // paquete de TypeScript del repo.
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        // T-059: tools/medir-rendimiento.mjs lleva funciones que Playwright
        // ejecuta DENTRO de la pagina (instrumentacion de frames, diagnosticos):
        // ahi existen los globales del navegador. Es una herramienta de medicion,
        // no gameplay: el reloj de juego sigue siendo clock.now() (regla 1).
        window: 'readonly',
        document: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        indexedDB: 'readonly',
        localStorage: 'readonly',
        getComputedStyle: 'readonly',
        KeyboardEvent: 'readonly',
        MediaRecorder: 'readonly',
        Blob: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
  },

  // -------------------------------------------------------------------------
  // Reglas de arquitectura. Ver CLAUDE.md.
  // Estas reglas reemplazan a los tests que verificaban lo mismo leyendo el
  // codigo fuente con fs: el linter cubre todo el repo, un test solo su archivo.
  // -------------------------------------------------------------------------

  {
    // Regla 1: el reloj es el audio.
    // Aplica a todo el codigo de gameplay, no solo al reloj. apps/web/src
    // entra a partir de T-004: es donde vive el bucle de juego real
    // (apps/web/src/game.ts). La unica lectura de performance.now()
    // permitida en el proyecto esta desde T-063 en
    // packages/audio/src/mapa-de-tiempo.ts (antes en game.ts, T-004): es la
    // regla comun entre el `timeStamp` de los eventos y el ancla que da
    // `ctx.getOutputTimestamp()`, y necesita su propio disable en linea
    // para poder existir.
    files: [
      'packages/core/**/*.ts',
      'packages/audio/**/*.ts',
      'packages/engine/**/*.ts',
      'apps/web/src/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'setTimeout',
          message: 'El tiempo sale de ctx.currentTime. Ver CLAUDE.md.',
        },
        {
          name: 'setInterval',
          message: 'El tiempo sale de ctx.currentTime. Ver CLAUDE.md.',
        },
        {
          name: 'requestAnimationFrame',
          message: 'rAF sirve para dibujar, nunca para medir tiempo de juego.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'performance',
          property: 'now',
          message: 'El tiempo sale de ctx.currentTime. Ver CLAUDE.md.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'El tiempo sale de ctx.currentTime. Ver CLAUDE.md.',
        },
      ],
    },
  },

  {
    // Regla 2: core no toca el navegador.
    // Es lo que lo mantiene testeable sin DOM y portable a otra plataforma.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'core no puede tocar el navegador.' },
        { name: 'document', message: 'core no puede tocar el navegador.' },
        { name: 'navigator', message: 'core no puede tocar el navegador.' },
        { name: 'performance', message: 'core no puede tocar el navegador.' },
        { name: 'localStorage', message: 'core no puede tocar el navegador.' },
        { name: 'AudioContext', message: 'core no puede tocar el navegador.' },
        { name: 'setTimeout', message: 'El tiempo sale de ctx.currentTime.' },
        { name: 'setInterval', message: 'El tiempo sale de ctx.currentTime.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tetra/audio', '@tetra/engine', '@tetra/storage'],
              message: 'core no importa de nadie.',
            },
            { group: ['pixi.js', 'react', 'react-dom'], message: 'core no importa de nadie.' },
          ],
        },
      ],
    },
  },

  {
    // Regla 3: storage es codigo de navegador (IndexedDB), asi que puede usar
    // globals del navegador, pero no es la capa de render: no importa Pixi ni
    // React. Y como toda capa por encima de core, jamas al reves.
    files: ['packages/storage/**/*.ts'],
    ignores: ['packages/storage/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pixi.js', 'react', 'react-dom'], message: 'storage no es la capa de render.' },
          ],
        },
      ],
    },
  },
];
