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
];
