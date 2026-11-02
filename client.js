/**
 * Client half of the "学习机地" bundle: a sidebar entry plus the page it opens.
 *
 * Both registrations share one id — the sidebar row's id IS the `main` key the
 * shell selects — so a click on the row swaps the center column to this page.
 * The page has two views: the paged release grid, and an in-panel detail view
 * with the game blurb and its download posts (magnet/pan links).
 */
window.__ModuleLoader__.load({
  id: 'dsh-study-jidi',
  inject: ['slots'],
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** The sidebar row id and the `main` key — one string by design. */
    const PANEL_ID = 'jidi-releases'
    const SITE = 'https://www.jidiyouxi.com'
    /** Sidebar row order: below the host's own pages, above later additions. */
    const PANEL_ORDER = 5
    const PAGE_SIZE = 20

    const SORTS = [
      { value: 'release', label: '最近发行' },
      { value: 'update', label: '最近更新' },
      { value: 'd7d', label: '本周最热' },
      { value: 'd30d', label: '本月最热' },
      { value: 'hot', label: '历史最热' },
    ]

    const BORDER = '1px solid rgba(128,128,128,0.26)'
    const SOFT_BG = 'rgba(128,128,128,0.07)'
    const CHIP_BG = 'rgba(128,128,128,0.12)'

    async function requestJson(url, signal) {
      const response = await fetch(url, {
        signal,
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || `请求失败（HTTP ${response.status}）`)
      }
      return body
    }

    function loadList({ sort, page, signal }) {
      const query = new URLSearchParams({ sort, page: String(page) })
      return requestJson(`/jidi-releases/list?${query.toString()}`, signal)
    }

    function loadDetail({ id, signal }) {
      const query = new URLSearchParams({ id: String(id) })
      return requestJson(`/jidi-releases/detail?${query.toString()}`, signal)
    }

    /**
     * Hand the URL to the browser. In the desktop app the shell turns an
     * http(s) `window.open` into the system browser; a plain anchor click is
     * the fallback for a renderer that blocks the popup outright.
     */
    function openInBrowser(url) {
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (opened) return
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    }

    /** A magnet: URL cannot reach the system browser on its own, so copy it. */
    async function copyText(text) {
      try {
        const response = await fetch('/jidi-releases/copy', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (response.ok) {
          const body = await response.json().catch(() => null)
          if (body && body.ok) return true
        }
      } catch {
        // fall through to the renderer clipboard
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        // fall through to the textarea trick
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch {
        return false
      }
    }

    function formatDay(seconds) {
      if (!seconds) return ''
      const date = new Date(seconds * 1000)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function formatCount(value) {
      return typeof value === 'number' && value > 0 ? value.toLocaleString('zh-CN') : '—'
    }

    function SidebarIcon(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
        h('path', { d: 'M3 9h18' }),
        h('path', { d: 'M8 13h3M9.5 11.5v3' }),
        h('circle', { cx: 16, cy: 13.5, r: 1.6 }),
      )
    }

    function ToolButton({ children, onClick, disabled, active }) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled,
          style: {
            font: 'inherit',
            fontSize: 12.5,
            padding: '5px 10px',
            borderRadius: 8,
            border: BORDER,
            background: active ? CHIP_BG : SOFT_BG,
            color: 'inherit',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          },
        },
        children,
      )
    }

    function Chip({ children, tone }) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 999,
            fontSize: 11.5,
            lineHeight: 1.5,
            background: tone === 'accent' ? 'rgba(94,142,255,0.16)' : CHIP_BG,
            color: tone === 'accent' ? '#7fa3ff' : 'inherit',
            opacity: tone === 'accent' ? 1 : 0.75,
            whiteSpace: 'nowrap',
          },
        },
        children,
      )
    }

    function Card({ item, onOpen }) {
      const meta = [item.releaseDate, ...(item.genres || [])].filter(Boolean).join(' · ')
      return h(
        'button',
        {
          type: 'button',
          title: `${item.title}\n${item.releaseDate || ''}`,
          onClick: () => onOpen(item),
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 0,
            border: BORDER,
            borderRadius: 10,
            background: SOFT_BG,
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            overflow: 'hidden',
            transition: 'border-color 120ms ease, transform 120ms ease',
          },
          onMouseEnter: (event) => {
            event.currentTarget.style.borderColor = 'rgba(128,128,128,0.6)'
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.borderColor = 'rgba(128,128,128,0.26)'
          },
        },
        h('div', {
          style: {
            width: '100%',
            aspectRatio: '310 / 136',
            background: 'rgba(128,128,128,0.14)',
            backgroundImage: item.banner || item.cover ? `url("${item.banner || item.cover}")` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          },
        }),
        h(
          'div',
          { style: { padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 5 } },
          h(
            'div',
            {
              style: {
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.35,
                minHeight: 36,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              },
            },
            item.title,
          ),
          h('div', { style: { fontSize: 11.5, opacity: 0.62 } }, meta || '暂无发行信息'),
          (item.tags || []).length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                item.tags.slice(0, 3).map((tag) => h(Chip, { key: tag }, tag)),
              )
            : null,
        ),
      )
    }

    /** Page numbers around the current page: 1 … 3 4 [5] 6 7 … 927. */
    function pageWindow(page, totalPages) {
      const span = 5
      let start = Math.max(1, page - 2)
      let end = start + span - 1
      if (end > totalPages) {
        end = totalPages
        start = Math.max(1, end - span + 1)
      }
      const pages = new Set([1, totalPages])
      for (let value = start; value <= end; value += 1) pages.add(value)
      return [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b)
    }

    function Pagination({ page, totalPages, total, disabled, onGo }) {
      const items = []
      let previous = 0
      for (const value of pageWindow(page, totalPages)) {
        if (previous && value - previous > 1) items.push(h('span', { key: `gap-${value}`, style: { opacity: 0.45, fontSize: 12 } }, '…'))
        items.push(
          h(
            'button',
            {
              key: value,
              type: 'button',
              onClick: () => onGo(value),
              disabled: disabled || value === page,
              style: {
                minWidth: 30,
                font: 'inherit',
                fontSize: 12.5,
                padding: '4px 7px',
                borderRadius: 8,
                border: value === page ? '1px solid rgba(94,142,255,0.75)' : BORDER,
                background: value === page ? 'rgba(94,142,255,0.18)' : SOFT_BG,
                color: 'inherit',
                cursor: disabled || value === page ? 'default' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              },
            },
            String(value),
          ),
        )
        previous = value
      }
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '14px 24px 22px',
            borderTop: BORDER,
          },
        },
        h(ToolButton, { onClick: () => onGo(page - 1), disabled: disabled || page <= 1 }, '‹ 上一页'),
        ...items,
        h(ToolButton, { onClick: () => onGo(page + 1), disabled: disabled || page >= totalPages }, '下一页 ›'),
        h('div', { style: { flex: 1 } }),
        h(
          'div',
          { style: { fontSize: 11.5, opacity: 0.55 } },
          `第 ${page} / ${totalPages} 页 · 共 ${formatCount(total)} 款`,
        ),
      )
    }

    /** Native <select> popups ignore our dark palette, so draw the menu ourselves. */
    function SortSelect({ value, disabled, onChange }) {
      const [open, setOpen] = useState(false)
      const boxRef = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])
      const current = SORTS.find((item) => item.value === value) || SORTS[0]
      return h(
        'div',
        { ref: boxRef, style: { position: 'relative' } },
        h(
          'button',
          {
            type: 'button',
            disabled,
            onClick: () => setOpen((previous) => !previous),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              font: 'inherit',
              fontSize: 12.5,
              padding: '5px 9px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-2)',
              color: 'var(--dsw-alias-label-primary)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            },
          },
          current.label,
          h('span', { style: { fontSize: 9, opacity: 0.6, lineHeight: 1 } }, open ? '▲' : '▼'),
        ),
        open
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  minWidth: '100%',
                  padding: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  borderRadius: 10,
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: 'var(--dsw-alias-bg-overlay)',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
                  zIndex: 40,
                },
              },
              SORTS.map((item) =>
                h(
                  'button',
                  {
                    key: item.value,
                    type: 'button',
                    onClick: () => {
                      setOpen(false)
                      if (item.value !== value) onChange(item.value)
                    },
                    style: {
                      font: 'inherit',
                      fontSize: 12.5,
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      padding: '6px 10px',
                      borderRadius: 7,
                      border: 'none',
                      background: item.value === value ? 'rgba(94,142,255,0.16)' : 'transparent',
                      color: item.value === value ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
                      cursor: 'pointer',
                    },
                  },
                  item.label,
                ),
              ),
            )
          : null,
      )
    }

    function LinkChip({ link, onCopied }) {
      const [result, setResult] = useState('')
      const minted = useRef(false)
      useEffect(
        () => () => {
          minted.current = true
        },
        [],
      )
      const accent = link.kind === 'magnet' ? 'rgba(255,178,86,0.2)' : link.kind === 'pan' ? 'rgba(94,142,255,0.18)' : CHIP_BG
      const color =
        result === 'copied' ? '#5ed37e' : result === 'failed' ? '#ff8a8a' : link.kind === 'magnet' ? '#ffb256' : link.kind === 'pan' ? '#7fa3ff' : 'inherit'
      const label =
        result === 'copied'
          ? '已复制'
          : result === 'failed'
            ? '复制失败'
            : link.kind === 'magnet'
              ? '磁力 · 复制'
              : link.kind === 'pan'
                ? '网盘'
                : '网页'
      return h(
        'button',
        {
          type: 'button',
          title: link.url,
          onClick: async () => {
            if (link.kind === 'magnet') {
              setResult('')
              const ok = await copyText(link.url)
              setResult(ok ? 'copied' : 'failed')
              window.setTimeout(() => {
                if (!minted.current) setResult('')
              }, 2400)
              if (onCopied) onCopied(ok ? '磁力链接已复制，可粘贴到迅雷' : '复制失败，请手动选择链接')
              return
            }
            openInBrowser(link.url)
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: '100%',
            padding: '4px 9px',
            borderRadius: 8,
            border: `1px solid ${color === 'inherit' ? 'rgba(128,128,128,0.3)' : color}`,
            background: accent,
            color,
            font: 'inherit',
            fontSize: 11.5,
            cursor: 'pointer',
          },
        },
        h('span', { style: { fontWeight: 600, whiteSpace: 'nowrap' } }, label),
        h(
          'span',
          {
            style: {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.8,
              maxWidth: 220,
            },
          },
          link.label,
        ),
      )
    }

    function DownloadPost({ post, onToast, index }) {
      const day = formatDay(post.updatedAt)
      const body = post.content || ''
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 14px',
            border: BORDER,
            borderRadius: 10,
            background: SOFT_BG,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 12, opacity: 0.5 } }, `#${index + 1}`),
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, post.title),
          typeof post.pv === 'number' && post.pv > 0 ? h(Chip, null, `${post.pv} 浏览`) : null,
          h('div', { style: { flex: 1 } }),
          day ? h('span', { style: { fontSize: 11.5, opacity: 0.5 } }, day) : null,
        ),
        post.links.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              post.links.map((link) => h(LinkChip, { key: link.url, link, onCopied: onToast })),
            )
          : null,
        body
          ? h(
              'div',
              {
                style: {
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  opacity: 0.78,
                },
              },
              body,
            )
          : null,
      )
    }

    function DetailView({ id, title, onBack, onToast }) {
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        const controller = new AbortController()
        let alive = true
        setLoading(true)
        setError('')
        loadDetail({ id, signal: controller.signal })
          .then((body) => {
            if (!alive) return
            setDetail(body.detail || null)
            setLoading(false)
          })
          .catch((cause) => {
            if (!alive || (cause && cause.name === 'AbortError')) return
            setError(String((cause && cause.message) || cause))
            setLoading(false)
          })
        return () => {
          alive = false
          controller.abort()
        }
      }, [id])

      const metaChips = []
      if (detail) {
        if (detail.releaseDate) metaChips.push(h(Chip, { key: 'date', tone: 'accent' }, `发行 ${detail.releaseDate}`))
        if (detail.platforms && detail.platforms !== 'To Be Confirmed') metaChips.push(h(Chip, { key: 'os' }, detail.platforms))
        for (const genre of detail.genres || []) metaChips.push(h(Chip, { key: `genre-${genre}` }, genre))
        for (const publisher of detail.publishers || []) metaChips.push(h(Chip, { key: `pub-${publisher}` }, publisher))
        if (detail.score > 0) metaChips.push(h(Chip, { key: 'score', tone: 'accent' }, `评分 ${detail.score}`))
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'inherit', font: 'inherit' } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 24px 12px',
              borderBottom: BORDER,
            },
          },
          h(ToolButton, { onClick: onBack }, '← 返回列表'),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
            h('div', { style: { fontSize: 15, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, detail ? detail.title : title || '游戏详情'),
            h('div', { style: { fontSize: 11.5, opacity: 0.55 } }, '机地 jidiyouxi.com · 下面是要下载的资源'),
          ),
          h('div', { style: { flex: 1 } }),
          detail && detail.siteUrl ? h(ToolButton, { onClick: () => openInBrowser(detail.siteUrl) }, '打开官网页面') : null,
        ),
        h(
          'div',
          { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 28px' } },
          loading
            ? h('div', { style: { fontSize: 13, opacity: 0.6 } }, '正在读取详情…')
            : error
              ? h('div', { style: { fontSize: 13, opacity: 0.8 } }, `读取失败：${error}`)
              : detail
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 980 } },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
                      h('div', {
                        style: {
                          width: 300,
                          aspectRatio: '310 / 136',
                          borderRadius: 10,
                          border: BORDER,
                          ...(detail.banner || detail.cover
                            ? {
                                backgroundImage: `url("${detail.banner || detail.cover}")`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                              }
                            : { background: CHIP_BG }),
                        },
                      }),
                      h(
                        'div',
                        { style: { flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 8 } },
                        h('div', { style: { fontSize: 17, fontWeight: 680, lineHeight: 1.3 } }, detail.title),
                        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, ...metaChips),
                        detail.shortDesc
                          ? h('div', { style: { fontSize: 12.5, opacity: 0.72, lineHeight: 1.6 } }, detail.shortDesc)
                          : null,
                      ),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                      h('div', { style: { fontSize: 13, fontWeight: 650 } }, '下载资源'),
                      h(
                        'div',
                        { style: { fontSize: 11.5, opacity: 0.55 } },
                        detail.posts.length > 0
                          ? `共 ${detail.posts.length} 个发布版本 · 磁力链接点击即复制，网盘链接点击用浏览器打开`
                          : '这个条目还没有发布下载资源',
                      ),
                      ...detail.posts.map((post, index) => h(DownloadPost, { key: post.id, post, index, onToast })),
                    ),
                    detail.screenshots.length > 0
                      ? h(
                          'div',
                          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                          h('div', { style: { fontSize: 13, fontWeight: 650 } }, '游戏截图'),
                          h(
                            'div',
                            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 } },
                            ...detail.screenshots.map((shot) =>
                              h('div', {
                                key: shot,
                                style: {
                                  aspectRatio: '16 / 9',
                                  borderRadius: 8,
                                  border: BORDER,
                                  backgroundImage: `url("${shot}")`,
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center',
                                },
                              }),
                            ),
                          ),
                        )
                      : null,
                    detail.about
                      ? h(
                          'div',
                          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                          h('div', { style: { fontSize: 13, fontWeight: 650 } }, '游戏介绍'),
                          h(
                            'div',
                            { style: { fontSize: 12.5, lineHeight: 1.75, whiteSpace: 'pre-wrap', opacity: 0.8 } },
                            detail.about,
                          ),
                        )
                      : null,
                  )
                : null,
        ),
      )
    }

    function ReleasesPanel() {
      const [sort, setSort] = useState('release')
      const [page, setPage] = useState(1)
      const [items, setItems] = useState([])
      const [total, setTotal] = useState(0)
      const [totalPages, setTotalPages] = useState(1)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [reloadAt, setReloadAt] = useState(0)
      const [openId, setOpenId] = useState(null)
      const [toast, setToast] = useState('')
      const toastTimer = useRef(null)

      const showToast = useCallback((message) => {
        setToast(message)
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(''), 4000)
      }, [])

      useEffect(
        () => () => {
          if (toastTimer.current) clearTimeout(toastTimer.current)
        },
        [],
      )

      useEffect(() => {
        const controller = new AbortController()
        let alive = true
        setLoading(true)
        setError('')
        loadList({ sort, page, signal: controller.signal })
          .then((body) => {
            if (!alive) return
            setItems(body.list || [])
            // Pages after the first carry no total; never wipe the known one.
            if (typeof body.total === 'number' && body.total > 0) setTotal(body.total)
            if (typeof body.totalPages === 'number' && body.totalPages > 1) setTotalPages(body.totalPages)
            setLoading(false)
          })
          .catch((cause) => {
            if (!alive || (cause && cause.name === 'AbortError')) return
            setError(String((cause && cause.message) || cause))
            setLoading(false)
          })
        return () => {
          alive = false
          controller.abort()
        }
      }, [sort, page, reloadAt])

      const goPage = useCallback((next) => {
        setPage((current) => {
          const target = Math.max(1, Math.min(totalPages, next))
          return target === current ? current : target
        })
      }, [totalPages])

      const toastEl = toast
        ? h(
            'div',
            {
              style: {
                position: 'fixed',
                left: '50%',
                bottom: 28,
                transform: 'translateX(-50%)',
                padding: '8px 14px',
                borderRadius: 10,
                fontSize: 12.5,
                background: 'rgba(32,32,32,0.92)',
                color: '#fff',
                boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
                pointerEvents: 'none',
                zIndex: 10,
              },
            },
            toast,
          )
        : null

      if (openId !== null) {
        return h(
          'div',
          {
            style: {
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              color: 'inherit',
              font: 'inherit',
            },
          },
          h(DetailView, {
            id: openId.id,
            title: openId.title,
            onBack: () => setOpenId(null),
            onToast: showToast,
          }),
          toastEl,
        )
      }

      return h(
        'div',
        { style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'inherit', font: 'inherit' } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              padding: '18px 24px 12px',
              borderBottom: '1px solid rgba(128,128,128,0.2)',
            },
          },
          h('div', { style: { fontSize: 16, fontWeight: 650 } }, '学习机地'),
          h('div', { style: { fontSize: 12, opacity: 0.55 } }, '机地 jidiyouxi.com · 详情与下载'),
          h('div', { style: { flex: 1 } }),
          h(SortSelect, {
            value: sort,
            disabled: loading,
            onChange: (next) => {
              setSort(next)
              setPage(1)
            },
          }),
          h(ToolButton, { onClick: () => setReloadAt((value) => value + 1), disabled: loading }, '刷新'),
          h(ToolButton, { onClick: () => openInBrowser(`${SITE}/topic/list`) }, '打开网站'),
        ),
        error
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 24px',
                  fontSize: 12.5,
                  background: 'rgba(255,120,120,0.12)',
                  borderBottom: BORDER,
                },
              },
              h('span', null, `刷新失败：${error}`),
              h(ToolButton, { onClick: () => setReloadAt((value) => value + 1) }, '重试'),
            )
          : null,
        h(
          'div',
          { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 20px' } },
          loading && items.length === 0
            ? h('div', { style: { fontSize: 13, opacity: 0.6 } }, '正在加载…')
            : items.length === 0
              ? h('div', { style: { fontSize: 13, opacity: 0.7 } }, '这里还没有内容')
              : h(
                  'div',
                  {
                    style: {
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(208px, 1fr))',
                      gap: 14,
                      opacity: loading ? 0.6 : 1,
                      transition: 'opacity 120ms ease',
                    },
                  },
                  ...items.map((item) =>
                    h(Card, {
                      key: item.id,
                      item,
                      onOpen: (target) => setOpenId({ id: target.id, title: target.title }),
                    }),
                  ),
                ),
        ),
        items.length > 0
          ? h(Pagination, {
              page,
              totalPages,
              total,
              disabled: loading,
              onGo: goPage,
            })
          : null,
        toastEl,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: '学习机地' },
            SidebarIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, ReleasesPanel),
        )
      },
    }
  },
})
