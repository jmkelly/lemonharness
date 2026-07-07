import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    ignores: ["**/node_modules/**", "**/dist/**"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      complexity: ["warn", 10],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "warn",
      "no-console": "off",
      "no-throw-literal": "warn",
      "prefer-object-spread": "warn",
      "no-useless-rename": "warn",
      "object-shorthand": ["warn", "always"],
      "@typescript-eslint/prefer-for-of": "warn",
    },
  },
];
