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
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // -------------------------------------------------------------------------
  // Reglas de arquitectura. Ver CLAUDE.md.
  // Estas reglas reemplazan a los tests que verificaban lo mismo leyendo el
  // codigo fuente con fs: el linter cubre todo el repo, un test solo su archivo.
  // -------------------------------------------------------------------------

  {
    // Regla 1: el reloj es el audio.
    // Aplica a todo el codigo de gameplay, no solo al reloj. apps/web/src
    // entra a partir de T-004: es donde vive el bucle de juego real
    // (apps/web/src/game.ts) y la unica lectura de performance.now()
    // permitida en el proyecto (ver docs/tickets/T-004-pista-y-entrada.md,
    // "El punto critico: el tiempo de la pulsacion"), que necesita su
    // propio eslint-disable-next-line para poder existir.
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
            { group: ['@tetra/audio', '@tetra/engine'], message: 'core no importa de nadie.' },
            { group: ['pixi.js', 'react', 'react-dom'], message: 'core no importa de nadie.' },
          ],
        },
      ],
    },
  },
];
