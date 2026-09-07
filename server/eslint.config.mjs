import js from '@eslint/js';

import gitignore from 'eslint-config-flat-gitignore';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// --- GCJ-02 boundary gate ------------------------------------------------
// The WGS84↔GCJ-02 converters exported by @trek/shared (src/geo/gcj02.ts)
// may only enter the server through the AMap provider boundary
// (src/nest/maps/providers/amap/**). Controllers, services, DTOs and the
// WS/REST wire are WGS84; a GCJ-02 value that slips past this rule doesn't
// throw — it quietly biases weather queries, tz-lookup and Atlas
// point-in-polygon. See docs/amap/00-constraints.md (坐标铁律).
const gcj02PathBan = {
  name: '@trek/shared',
  importNames: ['wgs2gcj', 'gcj2wgs', 'outOfChina'],
  message:
    'GCJ-02 is render-boundary-only: wgs2gcj/gcj2wgs/outOfChina may be imported only from src/nest/maps/providers/amap/**. Everything else is WGS84 — see docs/amap/00-constraints.md.',
};
const gcj02DeepBan = {
  group: ['**/geo/gcj02', '**/geo/gcj02.*'],
  message:
    'GCJ-02 is render-boundary-only: shared/src/geo/gcj02 may be imported only from src/nest/maps/providers/amap/**. Everything else is WGS84 — see docs/amap/00-constraints.md.',
};

// The services-layer ban and the GCJ-02 gate both configure
// no-restricted-imports, and flat config has no per-rule merge — the last
// block matching a file wins. The GCJ-02 block therefore re-states this
// shared object so the services wall keeps covering every file it covers
// today (the AMap provider dir stays covered by the original block below).
const servicesLayerBan = {
  group: ['**/services/*', '**/services/**/*'],
  message:
    'src/services/ is deleted. New backend code goes to src/nest/<domain>/ (service + controller + module, registered in app.module.ts). See src/nest/README.md.',
};

export default tseslint.config(
  gitignore({ strict: false }),
  {
    ignores: [
      'node_modules',
      'dist',
      'coverage',
      'public',
      'data',
      'uploads',
      'assets',
      'scripts/**',
      'reset-admin.js',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // --- Severities tuned to keep CI green on a codebase that was never linted ---
      // (each rule below has pre-existing violations; surfaced as warnings, not blockers)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // The server is CommonJS (tsconfig module: commonjs); require() is intentional throughout.
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // js.recommended rules with pre-existing hits in the never-linted codebase.
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
    },
  },
  {
    // Config-access guard: every env read in src/ goes through src/app-config
    // (readEnv() / derive functions / registerAs tokens). Direct process.env
    // access is banned outside the documented exemptions below — see
    // src/app-config/README.md for the rationale behind each.
    files: ['src/**/*.ts'],
    ignores: [
      // The config layer itself.
      'src/app-config/**',
      'src/nest/app-config/**',
      // Key-material resolution (file persistence + runtime rotation), not env config.
      'src/config.ts',
      // Scrubbed plugin child process — must not import app-config.
      'src/nest/plugins/runtime/plugin-host-entry.ts',
      // Child-env whitelist block: the env there is an IPC channel to the sandbox.
      'src/nest/plugins/supervisor/plugin-supervisor.ts',
      // Dynamic-key caps (process.env[name] with a computed name).
      'src/nest/plugins/host/daily-budget.ts',
      'src/nest/plugins/host/plugin-audit.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Read configuration via src/app-config (readEnv()/derive/tokens), not process.env. Exemptions: eslint.config.mjs + src/app-config/README.md.',
        },
        {
          // Bracket-notation variant (process['env']) — property is a Literal
          // node (.value), so the selector above can't match it.
          selector: "MemberExpression[object.name='process'][property.value='env']",
          message:
            'Read configuration via src/app-config (readEnv()/derive/tokens), not process.env. Exemptions: eslint.config.mjs + src/app-config/README.md.',
        },
      ],
    },
  },
  {
    // src/services/ is gone. It was the legacy layer this migration existed to
    // empty, and the last of it (airtrail) folded into src/nest/integrations/.
    //
    // The wall matters more than the deletion: the directory disappearing is not
    // what stops it coming back, because the way it grew was one file at a time,
    // each one reasonable on its own. A new domain goes to src/nest/<domain>/
    // with a service, a controller and a module.
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [servicesLayerBan],
        },
      ],
    },
  },
  {
    // GCJ-02 boundary gate (rationale on gcj02PathBan above). Exempts only
    // the AMap provider directory; re-includes the services-layer ban for
    // every other file, because the two share no-restricted-imports and flat
    // config is last-wins per rule. Must stay BEFORE the rpc-kit block so
    // the rpc-kit extraction deny-list — which already bans '@trek/**'
    // wholesale — keeps winning inside src/nest/plugins/host/rpc-kit/.
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    ignores: ['src/nest/maps/providers/amap/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [gcj02PathBan],
          patterns: [servicesLayerBan, gcj02DeepBan],
        },
      ],
    },
  },
  {
    // The plugin RPC decorator kit is written to stay extractable into its own
    // package, so its dependencies are pinned to Nest plus the two host modules it
    // genuinely needs. See src/nest/plugins/host/rpc-kit/README.md for what an
    // extraction would cost, and why the envelope import is the deliberate exception.
    files: ['src/nest/plugins/host/rpc-kit/**/*.ts'],
    rules: {
      // Written as a deny list rather than an allow list on purpose: these patterns
      // are gitignore-style, and a leading '**' would exclude the parent directory of
      // every allowed path, which makes the '!' re-includes silently ineffective.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                // The host modules next door.
                '../rpc-host',
                '../rpc-errors',
                '../rpc-params',
                '../rate-limit',
                '../daily-budget',
                '../plugin-audit',
                '../plugin-jobs',
                '../plugin-guards.service',
                '../plugin-host-*',
                // Everything one level up, in plugins/ itself.
                '../../*.service',
                '../../*.module',
                '../../*.controller',
                '../../dependencies',
                '../../dev-link',
                '../../kill-switch',
                '../../paths',
                '../../plugin-backup',
                '../../signature-status',
                '../../text-sanitize',
                '../../install/**',
                '../../registry/**',
                '../../runtime/**',
                '../../supervisor/**',
                // The wire protocol, except the one file the kit validates against.
                '../../protocol/*',
                '!../../protocol/envelope',
                // Anything outside the plugin subtree, and the rest of the app.
                '../../../**',
                '@trek/**',
                'node:*',
              ],
              message:
                'rpc-kit stays extractable: it may import @nestjs/common, @nestjs/core, its own files, and type-only from ../../protocol/envelope and ../plugin-data.service. See rpc-kit/README.md.',
            },
          ],
        },
      ],
    },
  },
);
