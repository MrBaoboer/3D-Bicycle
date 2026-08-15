import js from '@eslint/js';
import globals from 'globals';

/** 扁平配置，只开 recommended 一档；风格问题一概不管。 */
export default [
  { ignores: ['dist/**', 'node_modules/**', '.analysis/**', '.shots/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // 隐私模式读 localStorage、解码失败之类的空 catch 是有意的
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
    },
  },
];
