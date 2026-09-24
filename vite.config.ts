import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The URL path the app is served under, with leading and trailing slashes.
 * This is the one place it is set: BASE_PATH in the environment or in a
 * gitignored .env.local, else "/weatherdash/". `vite build --base` overrides it
 * for one build, which is how deploy.sh builds each environment. Nothing else
 * names it: the frontend reads import.meta.env.BASE_URL, the PHP works it out
 * from its own script path, and the web-root .htaccess is written below.
 */
const DEFAULT_BASE_PATH = '/weatherdash/'

/**
 * Writes public_html/.htaccess into the build as dist/.htaccess, with the base
 * path filled into its rewrite rules, so dist/ is the whole web root.
 */
function htaccess(): Plugin {
  let base = DEFAULT_BASE_PATH
  return {
    name: 'weatherdash-htaccess',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    generateBundle() {
      const template = readFileSync('public_html/.htaccess', 'utf8')
      this.emitFile({ type: 'asset', fileName: '.htaccess', source: template.replaceAll('%BASE_PATH%', base) })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), htaccess()],
  base: loadEnv(mode, process.cwd(), '').BASE_PATH || DEFAULT_BASE_PATH,
  build: {
    outDir: 'dist',
    sourcemap: false
  }
}))
