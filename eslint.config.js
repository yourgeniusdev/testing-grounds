import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.ts", "tests/**/*.ts", "*.config.ts"],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: 2022, sourceType: "module" } },
  rules: {}
});
