#!/usr/bin/env node
/**
 * CJ product search diagnostic — read-only.
 *
 * `product/listV2` authenticated fine but returned 0 items. This probes
 * parameter-name and keyword variants to find the combination that returns
 * real data, and prints the SHAPE of a result item (field names + types only,
 * first 40 chars of string values) so we can see which fields the scoring
 * engine can actually rely on.
 *
 * Prints no secrets. Read-only: no writes anywhere but stdout.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = path.resolve(HERE, '..', '.env.local')

const env = {}
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line)
  if (m) env[m[1]] = m[2].trim()
}

const SECRETS = [env.CJ_API_KEY].filter(Boolean)
const redact = (s) => {
  let out = String(s)
  for (const sec of SECRETS) if (sec) out = out.split(sec).join('[REDACTED]')
  return out
}
const log = (m = '') => process.stdout.write(redact(m) + '\n')

const BASE = 'https://developers.cjdropshipping.com/api2.0/v1'

async function get(url, headers) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 20000)
  try {
    const res = await fetch(url, { headers, signal: ac.signal })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    clearTimeout(t)
    return { status: res.status, json, text }
  } catch (e) {
    clearTimeout(t)
    return { status: 0, json: null, text: '', err: e }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- auth ---
const authRes = await fetch(`${BASE}/authentication/getAccessToken`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apiKey: env.CJ_API_KEY }),
})
const authJson = await authRes.json()
const token = authJson?.data?.accessToken
if (!token) {
  log('auth failed: ' + JSON.stringify(authJson).slice(0, 200))
  process.exit(1)
}
log('auth OK')

const headers = { 'CJ-Access-Token': token }

// --- probe parameter variants ---
const variants = [
  { label: 'keyWord=phone stand', qs: 'pageNum=1&pageSize=20&keyWord=phone%20stand' },
  { label: 'keyWord=phone', qs: 'pageNum=1&pageSize=20&keyWord=phone' },
  { label: 'keyWord=lamp', qs: 'pageNum=1&pageSize=20&keyWord=lamp' },
  { label: 'productNameEn=phone stand', qs: 'pageNum=1&pageSize=20&productNameEn=phone%20stand' },
  { label: 'productName=phone stand', qs: 'pageNum=1&pageSize=20&productName=phone%20stand' },
  { label: 'page/pageSize+keyWord', qs: 'page=1&pageSize=20&keyWord=phone' },
  { label: 'listV2 no keyword, pageSize=20', qs: 'pageNum=1&pageSize=20' },
  { label: 'product/list (v1) keyWord', qs: 'pageNum=1&pageSize=20&keyWord=phone', path: '/product/list' },
]

for (const v of variants) {
  await sleep(1100)
  const url = `${BASE}${v.path || '/product/listV2'}?${v.qs}`
  const r = await get(url, headers)
  const list = r.json?.data?.list
  const n = Array.isArray(list) ? list.length : -1
  const total = r.json?.data?.total ?? r.json?.data?.totalCount ?? 'n/a'
  log(`\n--- ${v.label}`)
  log(`    status=${r.status} result=${r.json?.result} code=${r.json?.code} message=${String(r.json?.message || '').slice(0, 80)}`)
  log(`    items=${n === -1 ? 'no data.list array' : n}  total=${total}`)
  if (n > 0) {
    const item = list[0]
    const keys = Object.keys(item)
    log(`    item keys (${keys.length}): ${keys.join(', ')}`)
    for (const k of keys) {
      const val = item[k]
      const type = Array.isArray(val) ? 'array' : typeof val
      let sample
      if (type === 'string') sample = `"${val.slice(0, 40)}"`
      else if (type === 'array') sample = `[${val.length} items] ${val.length && typeof val[0] === 'string' ? '"' + String(val[0]).slice(0, 40) + '"' : ''}`
      else if (type === 'object' && val) sample = `{${Object.keys(val).slice(0, 6).join(',')}}`
      else sample = String(val).slice(0, 40)
      log(`      ${k}: ${type} = ${sample}`)
    }
    log('    >>> this variant WORKS')
    break
  }
}

log('\ndone')
