/**
 * A throwaway receiver for `generate.html`: serves the page and writes what it
 * POSTs into a directory. It exists because a browser tab cannot write to disk
 * and passing a 2MB video back as base64 through a tool result is not a
 * transport. Run it, open the page, stop it.
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2] ?? join(here, 'out'))
await mkdir(out, { recursive: true })

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/save/')) {
    const name = req.url.slice('/save/'.length).replace(/[^a-zA-Z0-9._-]/g, '')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    await writeFile(join(out, name), body)
    console.log(`wrote ${name} ${body.length} bytes`)
    res.writeHead(200).end('ok')
    return
  }
  if (req.url.startsWith('/source.mp4')) {
    // The clip being prepared, served from wherever it actually lives so the
    // page can decode it without a copy into this directory.
    const body = await readFile(process.argv[3])
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length })
    res.end(body)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(await readFile(join(here, 'generate.html')))
}).listen(4599, () => console.log('hero-media generator on http://localhost:4599'))
