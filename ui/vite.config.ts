import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[vue()],build:{outDir:fileURLToPath(new URL('../dist/public',import.meta.url)),emptyOutDir:true},server:{host:'127.0.0.1',port:5173}});
