/**
 * Host half of the "学习机地" bundle: reads jidiyouxi.com's release list and
 * topic detail pages and hands them to the Client half over two same-origin
 * routes.
 *
 * Why this lives in Node:
 *  - The list API checks `Origin` and is signed with a fixed salt; a renderer
 *    cannot forge either header.
 *  - Every request past the first page needs a real guest identity (`h_m` +
 *    `token`). We mint one through `/api/account/register_guest` and keep it
 *    on disk, so pagination and detail pages work for a signed-out user.
 *
 * `node:https` rather than `fetch`: fetch treats `Origin`/`Referer` as
 * forbidden request headers and silently drops them.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const ORIGIN = 'https://www.jidiyouxi.com'
const API_LIST = 'https://api2.jidiyouxi.com/topic/get_topics'
const API_GUEST = `${ORIGIN}/api/account/register_guest`
const DETAIL_PAGE = (id) => `${ORIGIN}/topic/detail/${id}`
const SALT = 'YhD6TCs9VpAl'
const PAGE_SIZE = 20
const LIST_ROUTE = '/jidi-releases/list'
const DETAIL_ROUTE = '/jidi-releases/detail'
const COPY_ROUTE = '/jidi-releases/copy'
const SORTS = new Set(['release', 'update', 'd7d', 'd30d', 'hot'])
const TIMEOUT_MS = 20000
/** The API is answered by several edge nodes; a few of them reject an
 * otherwise valid request, so every call gets a couple of retries. */
const ATTEMPTS = 3
const RETRY_DELAY_MS = 400
const CACHE_TTL_MS = 120000
const DETAIL_TTL_MS = 300000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
/** Guest identity survives restarts — re-registering on every boot would be rude. */
const IDENTITY_FILE = join(homedir(), '.dsh', 'study-jidi-identity.json')

const LIST_CACHE = new Map()
const DETAIL_CACHE = new Map()
/** The site only answers data.total for page 1, so remember it per sort. */
const TOTALS = new Map()

let identity = null
let identityInflight = null

function md5(value) {
  return createHash('md5').update(value, 'utf8').digest('hex')
}

/** websign = "v2-" + md5(String(h_m || 0) + md5(body + salt)), over the exact bytes sent. */
export function webSign(body, hM) {
  const prefix = String(hM === undefined || hM === null ? 0 : hM)
  return `v2-${md5(`${prefix}${md5(body + SALT)}`)}`
}

function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { 'user-agent': UA, 'accept-encoding': 'identity', ...headers }
    if (body !== undefined) requestHeaders['content-length'] = Buffer.byteLength(body)
    const req = httpsRequest(url, { method, headers: requestHeaders }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          status: response.statusCode || 0,
          text: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('请求超时')))
    req.end(body)
  })
}

function baseHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'text/plain',
    origin: ORIGIN,
    referer: `${ORIGIN}/topic/list`,
  }
}

function loadIdentity() {
  if (identity) return identity
  try {
    const parsed = JSON.parse(readFileSync(IDENTITY_FILE, 'utf8'))
    if (parsed && parsed.h_m > 0 && typeof parsed.token === 'string' && parsed.token) {
      identity = { h_m: parsed.h_m, token: parsed.token, h_did: parsed.h_did || randomUUID() }
    }
  } catch {
    identity = null
  }
  return identity
}

function saveIdentity(next) {
  identity = next
  try {
    mkdirSync(dirname(IDENTITY_FILE), { recursive: true })
    writeFileSync(IDENTITY_FILE, JSON.stringify({ ...next, at: Date.now() }, null, 2), 'utf8')
  } catch {
    // A read-only home must not break browsing; the identity still lives in memory.
  }
}

/** Mint a throw-away guest account (mid + token) so paged requests are authorised. */
async function registerGuest() {
  const body = {
    h_m: 0,
    h_ts: Date.now(),
    h_dt: 2,
    h_did: randomUUID(),
    h_app: 'zgamer',
    h_ch: 'other',
  }
  const text = JSON.stringify(body)
  const { status, text: payload } = await request(`${API_GUEST}?websign=${webSign(text, 0)}`, {
    method: 'POST',
    body: text,
    headers: baseHeaders(),
  })
  if (status < 200 || status >= 300) throw new Error(`游客身份注册失败（HTTP ${status}）`)
  let json
  try {
    json = JSON.parse(payload)
  } catch {
    throw new Error('游客身份注册失败（返回内容无法解析）')
  }
  const data = (json && json.data) || {}
  if (!json || json.ret !== 1 || !data.mid || !data.token) {
    throw new Error((json && json.msg) || '游客身份注册失败')
  }
  const next = { h_m: data.mid, token: data.token, h_did: body.h_did }
  saveIdentity(next)
  return next
}

async function ensureIdentity(force = false) {
  if (!force) {
    const cached = loadIdentity()
    if (cached) return cached
  }
  if (!identityInflight) {
    identityInflight = registerGuest().finally(() => {
      identityInflight = null
    })
  }
  return identityInflight
}

function envFields(identity) {
  return {
    h_m: identity.h_m,
    h_ts: Date.now(),
    h_dt: 2,
    h_did: identity.h_did,
    token: identity.token,
    h_app: 'zgamer',
    cookie: `web_h_did=${identity.h_did}`,
    userAgent: UA,
    server_start_ts: Math.round(Date.now() / 1000) - 60,
    mobile: '',
    urlOrigin: 'http://www.jidiyouxi.com',
    requestUrl: '/topic/list',
    querystring: '',
    host: 'www.jidiyouxi.com',
    is_login: 0,
    authing: false,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One signed page of the topic list. `page` is 1-based, like the site's own pager. */
async function requestPage({ sort, page, identity: id }) {
  // The site builds the paging cursor itself: page N sends next_cb {"offset":(N-1)*20}.
  const nextCb = page <= 1 ? '' : JSON.stringify({ offset: (page - 1) * PAGE_SIZE })
  const body = {
    ...envFields(id),
    offset: 0,
    limit: PAGE_SIZE,
    next_cb: nextCb,
    cur_page: 'all_topic',
    sort,
    genre: '',
    ...(page <= 1 ? { query_total: 1 } : {}),
    h_ch: 'other',
  }
  const text = JSON.stringify(body)
  const { status, text: payload } = await request(`${API_LIST}?websign=${webSign(text, id.h_m)}`, {
    method: 'POST',
    body: text,
    headers: baseHeaders(),
  })
  if (status < 200 || status >= 300) throw new Error(`jidiyouxi HTTP ${status}`)
  let json
  try {
    json = JSON.parse(payload)
  } catch {
    throw new Error('jidiyouxi 返回了无法解析的内容')
  }
  if (json && json.data && typeof json.data.total === 'number' && json.data.total > 0) {
    TOTALS.set(sort, json.data.total)
  }
  if (!json || json.ret !== 1 || !json.data) {
    const error = new Error((json && json.msg) || 'jidiyouxi 返回了意外的数据结构')
    error.ret = json && json.ret
    throw error
  }
  return json.data
}

export async function fetchPage({ sort = 'release', page = 1 } = {}) {
  const key = `${sort}:${page}`
  const cached = LIST_CACHE.get(key)
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached.data
  let lastError
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const id = await ensureIdentity(false)
      const data = await requestPage({ sort, page, identity: id })
      LIST_CACHE.set(key, { at: Date.now(), data })
      return data
    } catch (error) {
      lastError = error
      // ret=-11 授权码错误 means the stored guest account went stale.
      if (error && error.ret === -11) {
        await ensureIdentity(true).catch(() => {})
      }
      if (attempt < ATTEMPTS - 1) await sleep(RETRY_DELAY_MS * (attempt + 1))
    }
  }
  if (cached !== undefined) return cached.data
  throw lastError
}

function firstUrl(block) {
  if (!block) return ''
  const urls = block.urls
  if (!Array.isArray(urls) || urls.length === 0) return ''
  const item = urls[0]
  if (typeof item === 'string') return item
  if (item && typeof item.url === 'string') return item.url
  return ''
}

/** Asset entries nest the same picture per size; take a sane width first. */
function sizedUrl(block, preferred = ['360', '540', '240', 'default']) {
  if (!block) return ''
  const urls = block.urls || {}
  for (const key of preferred) {
    const url = firstUrl(urls[key])
    if (url) return url
  }
  for (const key of Object.keys(urls)) {
    const url = firstUrl(urls[key])
    if (url) return url
  }
  return ''
}

/** Screenshot entries nest urls per size; take the widest available. */
function screenshotUrl(shot) {
  if (!shot) return ''
  const sizes = shot.urls || {}
  const keys = Object.keys(sizes)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
  for (const size of keys) {
    const url = firstUrl(sizes[String(size)])
    if (url) return url
  }
  return ''
}

function toCard(item) {
  const info = item.game_info || {}
  const covers = item.cover_urls || {}
  const rating = item.rating || {}
  return {
    id: item.id,
    title: item.topic || info.name || '',
    cover: firstUrl(covers.aspect_low) || firstUrl(covers.origin),
    banner: sizedUrl(info.header_image) || firstUrl(covers.aspect_low) || firstUrl(covers.origin),
    releaseDate: info.release_date || '',
    genres: Array.isArray(info.genres) ? info.genres.slice(0, 3) : [],
    tags: Array.isArray(info.game_user_tags) ? info.game_user_tags.slice(0, 4) : [],
    score: typeof rating.score === 'number' ? rating.score : 0,
  }
}

const LINK_PATTERN = /(magnet:\?[^\s"'<>]+|https?:\/\/[^\s"'<>，。）、]+)/g

function describeLink(url) {
  if (url.startsWith('magnet:')) {
    const match = /[?&]dn=([^&]+)/.exec(url)
    const name = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : ''
    return { kind: 'magnet', label: name || '磁力链接', url }
  }
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    host = '链接'
  }
  const kind = /pan\.|yun|drive|cloud|115|quark|aliyundrive|weiyun|lanzou|123pan/.test(host) ? 'pan' : 'web'
  return { kind, label: host, url }
}

function gatherLinks(content) {
  const seen = new Set()
  const links = []
  const text = String(content || '')
  for (const match of text.matchAll(LINK_PATTERN)) {
    const url = match[0]
    if (seen.has(url)) continue
    seen.add(url)
    const link = describeLink(url)
    // Author profiles and how-to links are page furniture, not downloads.
    if (link.kind === 'web' && /(^|\.)jidiyouxi\.com$|(^|\.)52jidi\.com$/.test(link.label)) continue
    links.push(link)
  }
  return links.slice(0, 6)
}

function toPost(post) {
  const content = String(post.content || '')
  return {
    id: post.id,
    title: post.title || '未命名资源',
    content,
    links: gatherLinks(content),
    updatedAt: post.ut || post.ct || 0,
    pv: post.pv || 0,
    images: (Array.isArray(post.imgs) ? post.imgs : []).map((img) => firstUrl(img)).filter(Boolean).slice(0, 4),
  }
}

function toDetail(topicState, id) {
  const current = topicState.currentTopic || {}
  const info = current.game_info || {}
  const rating = current.rating || {}
  const ssrDetail = (topicState.ssrData && topicState.ssrData.topicDetail) || {}
  const posts = (Array.isArray(ssrDetail.list) ? ssrDetail.list : []).map(toPost)
  const covers = current.cover_urls || {}
  const shots = (Array.isArray(info.screenshots) ? info.screenshots : [])
    .map(screenshotUrl)
    .filter(Boolean)
    .slice(0, 6)
  return {
    id: current.id || id,
    title: current.topic || info.name || '',
    cover: firstUrl(covers.aspect_low) || firstUrl(covers.origin),
    banner: sizedUrl(info.header_image) || firstUrl(covers.aspect_low) || firstUrl(covers.origin),
    header: info.header_image_uri ? `https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/${info.header_image_uri}` : '',
    about: info.about_game_txt || info.about_game || '',
    shortDesc: info.short_desc || '',
    releaseDate: info.release_date || '',
    platforms: info.os || '',
    publishers: Array.isArray(info.publishers) ? info.publishers : [],
    genres: Array.isArray(info.genres) ? info.genres : [],
    tags: Array.isArray(info.game_user_tags) ? info.game_user_tags : [],
    score: typeof rating.score === 'number' ? rating.score : 0,
    screenshots: shots,
    folders: Array.isArray(current.folder_list)
      ? current.folder_list.map((folder) => ({ id: folder.folder_id, name: folder.folder_name }))
      : [],
    posts,
    siteUrl: DETAIL_PAGE(current.id || id),
  }
}

/** The detail page is server-rendered; the state we want sits in one script tag. */
function readAppState(html) {
  const marker = 'window.APP_INITIAL_STATE='
  const start = html.indexOf(marker)
  if (start === -1) throw new Error('详情页缺少初始数据（站点改版了？）')
  const end = html.indexOf('</script>', start)
  if (end === -1) throw new Error('详情页初始数据不完整')
  const raw = html.slice(start + marker.length, end).trim().replace(/;$/, '')
  const state = JSON.parse(raw)
  const topicState = state && state.topic
  if (!topicState || !topicState.currentTopic) throw new Error('详情页初始数据里没有游戏信息')
  return topicState
}

export async function fetchDetail(id) {
  const key = String(id)
  const cached = DETAIL_CACHE.get(key)
  if (cached !== undefined && Date.now() - cached.at < DETAIL_TTL_MS) return cached.data
  let lastError
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const { status, text } = await request(DETAIL_PAGE(key), {
        headers: { accept: 'text/html,application/xhtml+xml', referer: `${ORIGIN}/topic/list` },
      })
      if (status < 200 || status >= 300) throw new Error(`jidiyouxi HTTP ${status}`)
      const data = toDetail(readAppState(text), key)
      DETAIL_CACHE.set(key, { at: Date.now(), data })
      return data
    } catch (error) {
      lastError = error
      if (attempt < ATTEMPTS - 1) await sleep(RETRY_DELAY_MS * (attempt + 1))
    }
  }
  if (cached !== undefined) return cached.data
  throw lastError
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function parseUrl(request) {
  return new URL(request.url || '/', 'http://localhost')
}

/** Pages after the first never carry a total, so fall back to the page-1 number. */
async function resolveTotal(sort) {
  const known = TOTALS.get(sort)
  if (known) return known
  try {
    await fetchPage({ sort, page: 1 })
  } catch {
    // ignore: the caller degrades to an unknown page count
  }
  return TOTALS.get(sort) || 0
}

async function handleList(request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, { allow: 'GET' })
    response.end()
    return
  }
  let url
  try {
    url = parseUrl(request)
  } catch {
    sendJson(response, 400, { ok: false, error: '无法解析请求地址' })
    return
  }
  const sortParam = url.searchParams.get('sort') || 'release'
  const sort = SORTS.has(sortParam) ? sortParam : 'release'
  const parsedPage = Number.parseInt(url.searchParams.get('page') || '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  try {
    const data = await fetchPage({ sort, page })
    const list = Array.isArray(data.list) ? data.list.map(toCard) : []
    const total = typeof data.total === 'number' && data.total > 0 ? data.total : await resolveTotal(sort)
    sendJson(response, 200, {
      ok: true,
      sort,
      page,
      pageSize: PAGE_SIZE,
      list,
      total,
      totalPages: total > 0 ? Math.ceil(total / PAGE_SIZE) : page + (data.more === 1 || data.more === true ? 1 : 0),
      more: data.more === 1 || data.more === true,
    })
  } catch (error) {
    sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleDetail(request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, { allow: 'GET' })
    response.end()
    return
  }
  let url
  try {
    url = parseUrl(request)
  } catch {
    sendJson(response, 400, { ok: false, error: '无法解析请求地址' })
    return
  }
  const id = (url.searchParams.get('id') || '').trim()
  if (!/^\d+$/.test(id)) {
    sendJson(response, 400, { ok: false, error: '缺少有效的游戏 id' })
    return
  }
  try {
    const detail = await fetchDetail(id)
    sendJson(response, 200, { ok: true, detail })
  } catch (error) {
    sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Push text onto the Windows clipboard — a magnet link cannot open a browser. */
function writeClipboard(text) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('clip.exe', [], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
    child.stdin.on('error', () => resolve(false))
    child.stdin.end(text, 'utf8')
  })
}

async function handleCopy(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += chunk.length
      if (size > 64 * 1024) throw new Error('请求体过大')
      chunks.push(chunk)
    }
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  let text = ''
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
  } catch {
    sendJson(response, 400, { ok: false, error: '请求体不是合法 JSON' })
    return
  }
  if (!text || text.length > 8192 || !/^(magnet:\S+|https?:\/\/\S+)$/i.test(text)) {
    sendJson(response, 400, { ok: false, error: '只接受磁力或网页链接' })
    return
  }
  const copied = await writeClipboard(text)
  if (!copied) {
    sendJson(response, 500, { ok: false, error: '写入剪贴板失败' })
    return
  }
  sendJson(response, 200, { ok: true })
}

/** Host entry: mount the list/details routes and the clipboard route on the Harness web server. */
export function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    const disposers = [
      scoped.webServer.register({ kind: 'exact', path: LIST_ROUTE, handler: handleList }),
      scoped.webServer.register({ kind: 'exact', path: DETAIL_ROUTE, handler: handleDetail }),
      scoped.webServer.register({ kind: 'exact', path: COPY_ROUTE, handler: handleCopy }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch {
          // ignore
        }
      }
    }
  })
}
