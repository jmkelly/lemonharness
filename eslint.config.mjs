import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      complexity: ["warn", 10],
      "no-empty": ["error", { allowEmptyCatch: false }],
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
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    },
  },
];
