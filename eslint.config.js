export default [
  {
    files: ["**/*.ts"],
    rules: {
      "complexity": ["warn", { "max": 10 }],
      "no-empty": ["error", { "allowEmptyCatch": false }],
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    },
  },
];
