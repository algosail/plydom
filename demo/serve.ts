/**
 * The demo's dev server: bundles `script.ts` for the browser and serves the page next to it.
 */

import * as esbuild from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const here = new URL ('.', import.meta.url)

const built = await esbuild.build ({
  entryPoints: [fileURLToPath (new URL ('script.ts', here))],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  plugins: [
    {
      name: 'plydom-self',
      setup(build) {
        build.onResolve ({ filter: /^@algosail\/plydom$/ }, () => ({
          path: fileURLToPath (new URL ('../dist/mod.js', import.meta.url)),
        }))
        build.onResolve ({ filter: /^@algosail\/plydom\/h$/ }, () => ({
          path: fileURLToPath (new URL ('../dist/h.js', import.meta.url)),
        }))
      },
    },
  ],
})
const script = built.outputFiles[0]?.text
if (script === undefined) throw new Error ('bundling the demo failed')

const page = await readFile (new URL ('index.html', here), 'utf8')
const port = 8000

createServer ((request, response) => {
  const pathname = new URL (request.url ?? '/', `http://localhost:${port}`).pathname
  const body = pathname === '/script.js' ? script : page
  const type = pathname === '/script.js' ? 'text/javascript' : 'text/html'
  response.writeHead (200, { 'content-type': `${type}; charset=utf-8` })
  response.end (body)
}).listen (port, () => {
  console.log (`http://localhost:${port}`)
})
