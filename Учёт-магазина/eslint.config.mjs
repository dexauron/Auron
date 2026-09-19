export default [
  /* Чужие библиотеки лежат в vendor/ сжатыми в одну строку. Проверять их
     нечего — их пишем не мы, — а тысяча их замечаний прятала наши. */
  { ignores: ['vendor/**'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
        FileReader: 'readonly', Blob: 'readonly', URL: 'readonly', File: 'readonly',
        TextDecoder: 'readonly', TextEncoder: 'readonly', fetch: 'readonly',
        module: 'writable', require: 'readonly', self: 'readonly', globalThis: 'readonly',
        XLSX: 'readonly', Chart: 'readonly', Fuse: 'readonly', Papa: 'readonly',
        ss: 'readonly', jspdf: 'readonly', BigInt: 'readonly', Intl: 'readonly',
        alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
        requestAnimationFrame: 'readonly', matchMedia: 'readonly',
        getComputedStyle: 'readonly',
        indexedDB: 'readonly', crypto: 'readonly', location: 'readonly',
        history: 'readonly', screen: 'readonly', performance: 'readonly',
        DOMParser: 'readonly', Image: 'readonly', FormData: 'readonly',
        AbortController: 'readonly', structuredClone: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-constant-condition': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-sparse-arrays': 'error',
      'no-func-assign': 'error',
      'no-cond-assign': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
      'no-fallthrough': 'error',
      'no-redeclare': 'error',
      'no-shadow-restricted-names': 'error',
      'no-implicit-globals': 'error'
    }
  },
  /* Проверки запускаются в Node, а не в браузере: там свои имена. Без
     этого проверки давали три десятка замечаний на ровном месте, и в них
     тонули настоящие. */
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      globals: { require: 'readonly', module: 'writable', process: 'readonly',
        __dirname: 'readonly', __filename: 'readonly', Buffer: 'readonly',
        console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        URL: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly' }
    },
    rules: { 'no-implicit-globals': 'off' }
  }
];
