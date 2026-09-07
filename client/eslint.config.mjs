import js from '@eslint/js';

import gitignore from 'eslint-config-flat-gitignore';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Minimal stub so the existing `// eslint-disable-next-line react/no-danger`
// directive in src/i18n/TransHtml.tsx resolves without pulling in the full
// eslint-plugin-react (not a dependency here). The rule is a no-op.
const reactStub = {
  rules: {
    'no-danger': {
      meta: { schema: [] },
      create() {
        return {};
      },
    },
  },
};

// react-dom/server ban, factored out so the AMap-override block below can
// re-state it verbatim without the two messages drifting apart.
const reactDomServerBan = {
  name: 'react-dom/server',
  message: 'Use renderIconMarkup from utils/iconMarkup — Fizz is ~190 KB for one <svg>.',
};

// GCJ-02 boundary gate. The WGS84↔GCJ-02 converters in @trek/shared
// (src/geo/gcj02.ts) may only be imported by the AMap renderer boundary.
// Everything else in the client handles WGS84 — stores, repos, Dexie, the
// mutation queue — and a GCJ-02 value that leaks past this rule doesn't
// crash: it just quietly lands every point a few hundred metres off and
// biases downstream weather/timezone/polygon consumers. Same family of gate
// as lint:pages and check:gl-split. See docs/amap/00-constraints.md (坐标铁律).
const gcj02BoundaryGate = {
  paths: [
    {
      name: '@trek/shared',
      importNames: ['wgs2gcj', 'gcj2wgs', 'outOfChina'],
      message:
        'GCJ-02 is render-boundary-only: wgs2gcj/gcj2wgs/outOfChina may be imported only from src/components/Map/engines/amap/**. Everything else is WGS84 — see docs/amap/00-constraints.md.',
    },
  ],
  patterns: [
    {
      group: ['**/geo/gcj02', '**/geo/gcj02.*'],
      message:
        'GCJ-02 is render-boundary-only: shared/src/geo/gcj02 may be imported only from src/components/Map/engines/amap/**. Everything else is WGS84 — see docs/amap/00-constraints.md.',
    },
  ],
};

export default tseslint.config(
  gitignore({ strict: false }),
  {
    ignores: [
      'node_modules',
      'dist',
      'coverage',
      'public',
      'test-results',
      'playwright-report',
      'e2e/**',
      'scripts/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      react: reactStub,
    },
    rules: {
      'react/no-danger': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // --- Severities tuned to keep CI green on a codebase that was never linted ---
      // (each rule below has pre-existing violations; surfaced as warnings, not blockers)

      // rules-of-hooks has one conditional-hook violation in PlaceInspector.tsx -> warn (not error).
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',

      // js.recommended rules with pre-existing hits.
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
  {
    // react-dom/server was worth ~190 KB raw / 57 KB gzip in a chunk three lazy
    // routes share — including the Leaflet renderer, which is the default — for
    // output that is always a single <svg>. utils/iconMarkup.ts does that job
    // without Fizz, and this keeps the import from creeping back: nothing else
    // would notice, the build stays green and the app keeps working.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            reactDomServerBan,
            // The GCJ-02 gate rides on this block because flat config has no
            // per-rule merge: the two bans have different exemption sets, and
            // a plain separate block would silently replace this one (or be
            // replaced by it). Test files are exempt here and covered by the
            // dedicated block at the bottom.
            ...gcj02BoundaryGate.paths,
          ],
          patterns: gcj02BoundaryGate.patterns,
        },
      ],
      'no-restricted-syntax': ['error', {
        selector: "ImportExpression > Literal[value=/^react-dom\\u002F(server|static)/]",
        message: 'Use renderIconMarkup from utils/iconMarkup — Fizz is ~190 KB for one <svg>.',
      }],
    },
  },
  {
    // The GCJ-02 exemption, expressed as a last-wins override: inside the AMap
    // renderer boundary this block replaces the merged ban above with the
    // react-dom/server ban alone, so amap/** may import the converters while
    // the Fizz ban stays universal. Must stay directly after the block above.
    files: ['src/components/Map/engines/amap/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [reactDomServerBan],
        },
      ],
    },
  },
  {
    // GCJ-02 gate for test files. The merged block skips *test.{ts,tsx} so the
    // react-dom/server ban keeps its existing scope; the coordinate rule must
    // still cover tests, with the same single exemption. The file sets here
    // and above are disjoint on purpose — overlapping blocks would clobber
    // one of the two bans.
    files: ['src/**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    ignores: ['src/components/Map/engines/amap/**'],
    rules: {
      'no-restricted-imports': ['error', gcj02BoundaryGate],
    },
  },
);
