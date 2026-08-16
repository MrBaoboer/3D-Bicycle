import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * 开发期探针：页面把 canvas 的 dataURL POST 过来，落到 .shots/。
 * 用于无法直接截屏的环境（面板隐藏时 rAF 停摆，外部截屏拿到的是旧帧）。
 * apply: 'serve' —— 不进生产构建。
 */
const devShot = () => ({
  name: 'dev-shot',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { name = 'shot', data } = JSON.parse(body);
          mkdirSync('.shots', { recursive: true });
          const file = `.shots/${name.replace(/[^\w.-]/g, '_')}.png`;
          writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, file }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    });
  },
});

/*
 * 产物用相对路径，放子路径下不用改配置。
 * three 单独切一个 chunk —— 它比其余全部代码加起来还大。
 * 分包按 Vite 8 的 rolldown 写：键是 build.rolldownOptions（不是 rollupOptions），
 * 分组用 output.codeSplitting.groups 按模块 id 匹配（manualChunks 在这里无效）。
 */
export default defineConfig({
  base: './',
  plugins: [devShot()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,        // 模型与解码器一律走文件，不要内联进 JS
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three/ }],
        },
      },
    },
  },
  server: { port: 5174 },
});
