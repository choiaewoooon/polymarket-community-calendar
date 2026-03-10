import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                admin: resolve(__dirname, 'admin/index.html'),
            },
        },
    },
    server: {
        proxy: {
            '/api/gamma': {
                target: 'https://gamma-api.polymarket.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/gamma/, ''),
            },
        },
    },
});
