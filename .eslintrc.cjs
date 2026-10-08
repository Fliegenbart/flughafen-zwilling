module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  plugins: ["@typescript-eslint", "react", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier",
  ],
  ignorePatterns: ["dist", "node_modules"],
  overrides: [
    {
      // Das Kundenprodukt (src/aec) greift nicht in die alten Werkzeuge. Einzige Naht ist
      // Werkstatt.tsx, die sie als Detailwerkzeuge einbettet. Typ-Importe (API-Vertraege)
      // sind erlaubt; Gemeinsames liegt in src/shared und src/ui.
      files: ["src/aec/**/*.{ts,tsx}"],
      excludedFiles: ["src/aec/Werkstatt.tsx", "src/aec/**/*.test.{ts,tsx}"],
      rules: {
        "@typescript-eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/lab/*", "**/munich/*", "**/pilot/*", "**/App", "**/WorkspaceApp"],
                allowTypeImports: true,
                message:
                  "Kundenprodukt nicht an alte Werkzeuge koppeln: Gemeinsames nach src/shared.",
              },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "react-hooks/exhaustive-deps": "error",
  },
};
