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

/**
 * 内容安全策略，**只进生产产物**。
 *
 * 这个页面不取任何外部资源：脚本与样式是打包出来的、模型在 public/ 下同源、
 * 音效是 Web Audio 现场合成的、图标是内联 SVG。既然如此，把门关死没有代价。
 * data: 留给首页那枚 SVG favicon。
 *
 * 不能写进 index.html —— 开发期 Vite 靠动态 <style> 注样式，
 * `style-src 'self'` 会把它整个挡下来，`npm run dev` 当场白屏。
 */
const CSP = [
  "default-src 'self'",
  // GLTFLoader 把 GLB 里的贴图切成 blob: 再取回来 —— 少了这一条，整车加载到贴图那步直接断
  "connect-src 'self' blob:",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = () => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) => ({
    html,
    tags: [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    }],
  }),
});

/*
 * 产物用相对路径，放子路径下不用改配置。
 * three 单独切一个 chunk —— 它比其余全部代码加起来还大。
 * 分包按 Vite 8 的 rolldown 写：键是 build.rolldownOptions（不是 rollupOptions），
 * 分组用 output.codeSplitting.groups 按模块 id 匹配（manualChunks 在这里无效）。
 */
export default defineConfig({
  base: './',
  plugins: [devShot(), csp()],
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
