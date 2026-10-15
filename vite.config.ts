import { defineConfig } from 'vitest/config';

// base './' 保证构建产物可在子目录以相对路径托管
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020'
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
});
