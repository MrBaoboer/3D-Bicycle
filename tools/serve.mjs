/**
 * 极简静态服务器 —— 冒烟走查与截图共用。
 * 不引 express：产物就几个文件，一个 createServer 足够，
 * 而 devDependencies 里每多一个包，CI 就多一份安装时间与一份供应链面。
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.ktx2': 'image/ktx2',
};

/**
 * 起一个只读的静态服务器，端口由系统分配。
 * @param {string} dir 站点根
 * @returns {Promise<{server: import('node:http').Server, port: number}>}
 */
export function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = join(dir, url === '/' ? 'index.html' : url);
      // 目录穿越：请求 /../../etc/passwd 这类，一律 403
      if (!file.startsWith(dir)) { res.statusCode = 403; return res.end(); }
      const buf = await readFile(file);
      res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
      return res.end(buf);
    } catch {
      res.statusCode = 404;
      return res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}
