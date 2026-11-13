import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow explicit any for gradual typing (reduce noise)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-function": "off",
      // A catch block must at least say why it's empty.
      "no-empty": ["error", { allowEmptyCatch: false }],
      // Prefer const
      "prefer-const": "warn",
    },
  },
  {
    // Promise misuse: a dropped promise hides its rejection, so fire-and-
    // forget calls must be explicit (`void notify(...)`). Async React event
    // handlers are fine (attributes: false); they handle their own errors.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    // All configuration goes through env() in src/lib/env.ts (validated,
    // read at call time). NODE_ENV / NEXT_RUNTIME are framework-set, not
    // Lexarr config, so they stay readable anywhere.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/env.ts", "src/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name!=/^(NODE_ENV|NEXT_RUNTIME)$/]",
          message:
            "Read configuration through env() from @/lib/env (add the variable to its schema) instead of process.env.",
        },
      ],
    },
  },
  {
    // Node-side tooling: the e2e stub server/seed and the helper scripts.
    files: ["e2e/**/*.{ts,mjs}", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    ignores: [
      "node_modules/",
      ".next/",
      "out/",
      "prisma/",
      "playwright-report/",
      "test-results/",
      "*.config.*",
    ],
  },
);
