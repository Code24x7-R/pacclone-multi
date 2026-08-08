/**
 * ESLint flat config for pacclone-multi.
 * Vanilla JS project — no TypeScript, no React.
 */
module.exports = [
  {
    files: ["server.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script", // server.js uses CommonJS (require)
      globals: {
        // Node.js globals
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        // Browser globals (client code in index.html, tested via jsdom)
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        WebSocket: "readonly",
        requestAnimationFrame: "readonly",
        alert: "readonly",
        CanvasRenderingContext2D: "readonly",
        AudioContext: "readonly",
        webkitAudioContext: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off", // server.js relies heavily on console.log
      eqeqeq: "error",
      "no-var": "off", // project uses var/let mix; leave as-is for now
      "prefer-const": "warn",
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        // Jest globals
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
  },
];
