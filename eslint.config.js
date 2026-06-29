import tseslint from 'typescript-eslint';

/**
 * Layer dependency direction (enforced):
 *   types -> domain -> infra -> state -> ui
 * Each layer may only import from layers to its LEFT (plus itself).
 * The domain layer (L1) must NOT import React / Dexie / network.
 *
 * Enforced with the built-in `no-restricted-imports` rule (no resolver needed):
 * forbidden module names + path globs (relative `**\/<layer>\/**` and aliased `@/<layer>/*`).
 */

const FRAMEWORK_LIBS = [
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'zustand',
  '@tanstack/react-query',
];

const PERSISTENCE_LIBS = ['dexie', 'dexie-react-hooks'];

const NETWORK_LIBS = ['axios', 'node:http', 'node:https', 'undici'];

/** Build a no-restricted-imports rule banning given libs and rightward layer dirs. */
function boundary({ libs, layers }) {
  return [
    'error',
    {
      paths: libs.map((name) => ({
        name,
        message: `Forbidden import for this layer (dependency direction: types -> domain -> infra -> state -> ui).`,
      })),
      patterns: layers.flatMap((layer) => [
        {
          group: [`**/${layer}/**`, `@/${layer}`, `@/${layer}/*`],
          message: `Forbidden cross-layer import: this layer may not import from "${layer}/".`,
        },
      ]),
    },
  ];
}

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'support.js'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // L0 types: no framework/persistence/network, no imports from any other layer.
  {
    files: ['src/types/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary({
        libs: [...FRAMEWORK_LIBS, ...PERSISTENCE_LIBS, ...NETWORK_LIBS],
        layers: ['domain', 'infra', 'state', 'ui'],
      }),
    },
  },
  // L1 domain: pure. No React / Dexie / network. No infra/state/ui.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary({
        libs: [...FRAMEWORK_LIBS, ...PERSISTENCE_LIBS, ...NETWORK_LIBS],
        layers: ['infra', 'state', 'ui'],
      }),
    },
  },
  // L2 infra: may use Dexie/network, but no React state libs and no state/ui.
  {
    files: ['src/infra/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary({
        libs: FRAMEWORK_LIBS,
        layers: ['state', 'ui'],
      }),
    },
  },
  // L3 state: no ui.
  {
    files: ['src/state/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': boundary({ libs: [], layers: ['ui'] }),
    },
  },
  // Tests may import freely.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
