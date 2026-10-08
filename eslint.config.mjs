import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Testes e utilitários de teste: globais do Jest e `any` liberado na infra de mock.
    files: ['**/*.spec.ts', '**/__test-utils__/**/*.ts', '**/__mocks__/**/*.ts'],
    languageOptions: {
      globals: { ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['apps/client/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='useEffect']",
          message:
            'useEffect é proibido no client (regra do projeto). Centralize efeitos no listener do store, event handlers ou TanStack Query.',
        },
      ],
    },
  },
  prettier
)
