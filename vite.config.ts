import { configDefaults } from 'vitest/config';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Serves api/*.ts (Vercel functions with a `GET(request)` export) during `npm run dev`. */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/', async (req, res, next) => {
        const name = req.url?.split('?')[0].replace(/^\//, '');
        if (!name || !/^[a-z-]+$/.test(name)) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const url = `http://${req.headers.host}/api/${req.url?.replace(/^\//, '')}`;
          const response: Response = await mod.GET(new Request(url, { headers: req.headers as Record<string, string> }));
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(await response.text());
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  // Agents' worktrees hold copies of the tests.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
