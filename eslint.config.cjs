const { FlatCompat } = require("@eslint/eslintrc");
const js = require("@eslint/js");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),
  ...compat.env({
    node: true,
    es2022: true,
    jest: true,
  }),
  ...compat.plugins("@typescript-eslint"),
  ...compat.config({
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      project: "./tsconfig.eslint.json",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  }),
  {
    ignores: ["dist/", "node_modules/", "coverage/", "jest.config.js", "**/*.js"],
  },
];
