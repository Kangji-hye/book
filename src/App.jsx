import { useState, useEffect, useCallback, useRef } from 'react'
import supabase from './supabaseClient'
import CameraScanner from './components/CameraScanner'
import './App.css'

// ── 상수 ──────────────────────────────────────────────────────────────────────
const LIB_STATUS = {
  loading:     { label: '조회 중…',     cls: 'loading' },
  available:   { label: '✅ 대출 가능',  cls: 'available' },
  unavailable: { label: '🔴 대출 중',    cls: 'unavailable' },
  none:        { label: '⬜ 미소장',     cls: 'none' },
  error:       { label: '⚠ 오류',       cls: 'error' },
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function cleanTitle(title) {
  return title
    .replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/【.*?】/g, '')
    .replace(/『.*?』/g, '').replace(/「.*?」/g, '')
    .replace(/[!@#$%^&*_+={|}\\<>?/~`'"]/g, '')
    .replace(/\s+/g, ' ').trim()
}

function stripHtml(str = '') {
  return str.replace(/<[^>]*>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"')
}

function formatPubdate(d = '') {
  if (d.length === 8) return `${d.slice(0,4)}년 ${d.slice(4,6)}월 ${d.slice(6,8)}일`
  return d
}

// ── 거리 계산 (Haversine, km) ─────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ── 주변 도서관 검색 ──────────────────────────────────────────────────────────
async function fetchNearbyLibs(lat, lng, radius = 5) {
  const res = await fetch(`/api/lib-search?lat=${lat}&lng=${lng}&radius=${radius}`)
  const data = await res.json()
  const libs = data?.response?.libs ?? []
  return libs
    .map(({ lib }) => ({
      libCode: lib.libCode,
      libName: lib.libName,
      address: lib.address ?? '',
      homepage: lib.homepage ?? '',
      lat: parseFloat(lib.latitude),
      lng: parseFloat(lib.longitude),
      distance: haversine(lat, lng, parseFloat(lib.latitude), parseFloat(lib.longitude)),
    }))
    .sort((a, b) => a.distance - b.distance)
}

// ── 소장/대출 여부 확인 ───────────────────────────────────────────────────────
async function checkBookExist(libCode, isbn) {
  try {
    const res = await fetch(`/api/book-exist?libCode=${libCode}&isbn=${isbn}`)
    const data = await res.json()
    const result = data?.response?.result
    if (!result) return 'error'
    if (result.hasBook === 'N') return 'none'
    return result.loanAvailable === 'Y' ? 'available' : 'unavailable'
  } catch {
    return 'error'
  }
}

// ── 책 정보 조회 (Google Books → 도서관 → 네이버) ───────────────────────────
async function fetchBookInfo(isbn) {
  const clean = isbn.replace(/-/g, '').trim()
  if (!clean) return null

  // 1순위: Google Books API (CORS 문제 없음, ISBN 정확 검색)
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${clean}`)
    if (res.ok) {
      const data = await res.json()
      const item = data?.items?.[0]?.volumeInfo
      if (item?.title) {
        return {
          title: item.title,
          author: (item.authors ?? []).join(', '),
          thumbnail: (item.imageLinks?.thumbnail ?? '').replace('http:', 'https:'),
          description: item.description ?? '',
          publisher: item.publisher ?? '',
          pubdate: item.publishedDate ?? '',
          link: item.infoLink ?? '',
          price: '',
          isbn: clean,
          source: 'google',
        }
      }
    }
  } catch { /* 폴백 */ }

  // 2순위: 도서관 정보나루 API (한국 도서 특화)
  const libKey = import.meta.env.VITE_LIB_APIKEY || ''
  if (libKey) {
    try {
      const res = await fetch(
        `https://www.data4library.kr/api/srchBooks?authKey=${libKey}&isbn13=${clean}&format=json`
      )
      if (res.ok) {
        const data = await res.json()
        const doc = data?.response?.docs?.[0]?.doc
        if (doc?.bookname) {
          return {
            title: doc.bookname,
            author: doc.authors ?? '',
            thumbnail: doc.bookImageURL ?? '',
            description: doc.description ?? '',
            publisher: doc.publisher ?? '',
            pubdate: '',
            link: '',
            price: '',
            isbn: clean,
            source: 'lib',
          }
        }
      }
    } catch { /* 폴백 */ }
  }

  // 3순위: 네이버 책 검색 API (서버 프록시 경유, ISBN 일치 검증)
  const naverId = import.meta.env.VITE_NAVER_CLIENT_ID || ''
  const naverSecret = import.meta.env.VITE_NAVER_CLIENT_SECRET || ''
  if (naverId && naverSecret) {
    try {
      const url = import.meta.env.DEV
        ? `/naver-api/v1/search/book.json?query=${encodeURIComponent(clean)}&display=5`
        : `/api/naver-search?query=${encodeURIComponent(clean)}`
      const fetchOpts = import.meta.env.DEV
        ? { headers: { 'X-Naver-Client-Id': naverId, 'X-Naver-Client-Secret': naverSecret } }
        : {}
      const res = await fetch(url, fetchOpts)
      if (res.ok) {
        const data = await res.json()
        // ISBN이 일치하는 항목만 사용 (엉뚱한 책 반환 방지)
        const items = data?.items ?? []
        const item = items.find(i => (i.isbn ?? '').replace(/-/g, '').includes(clean))
        if (item?.title) {
          return {
            title: stripHtml(item.title),
            author: item.author ?? '',
            thumbnail: item.image ?? '',
            description: stripHtml(item.description ?? ''),
            publisher: item.publisher ?? '',
            pubdate: formatPubdate(item.pubdate ?? ''),
            link: item.link ?? '',
            price: item.discount ? `${Number(item.discount).toLocaleString()}원` : '',
            isbn: clean,
            source: 'naver',
          }
        }
      }
    } catch { /* 폴백 */ }
  }

  return null
}

// ── Supabase ISBN 조회 ────────────────────────────────────────────────────────
async function searchByIsbn(isbn) {
  const clean = isbn.replace(/-/g, '').trim()
  const [rb, jrb, rrb, jrrb] = await Promise.all([
    supabase.from('recommended_books').select('grade_code,book_no,title,author').eq('isbn', clean),
    supabase.from('jangmi_recommended_books').select('grade_code,book_no,title,author').eq('isbn', clean),
    supabase.from('reading_race_books').select('title,author,level').eq('isbn', clean),
    supabase.from('jangmi_reading_race_books').select('title,author,level').eq('isbn', clean),
  ])
  const seen = new Set()
  const recommended = [...(rb.data ?? []), ...(jrb.data ?? [])].filter(r => {
    const k = `${r.grade_code}-${r.book_no}`; if (seen.has(k)) return false; seen.add(k); return true
  })
  const rSeen = new Set()
  const race = [...(rrb.data ?? []), ...(jrrb.data ?? [])].filter(r => {
    const k = `${r.level}-${r.title}`; if (rSeen.has(k)) return false; rSeen.add(k); return true
  })
  return { recommended, race }
}

// ── Supabase 제목 검색 ────────────────────────────────────────────────────────
async function searchLists(title) {
  const q = title.replace(/\(.*?\)/g, '').trim()
  if (!q) return { recommended: [], race: [] }
  const [rb, jrb, rrb, jrrb] = await Promise.all([
    supabase.from('recommended_books').select('grade_code,book_no,title,author').ilike('title', `%${q}%`),
    supabase.from('jangmi_recommended_books').select('grade_code,book_no,title,author').ilike('title', `%${q}%`),
    supabase.from('reading_race_books').select('title,author,level').ilike('title', `%${q}%`),
    supabase.from('jangmi_reading_race_books').select('title,author,level').ilike('title', `%${q}%`),
  ])
  const seen = new Set()
  const recommended = [...(rb.data ?? []), ...(jrb.data ?? [])].filter(r => {
    const k = `${r.grade_code}-${r.book_no}`; if (seen.has(k)) return false; seen.add(k); return true
  })
  const rSeen = new Set()
  const race = [...(rrb.data ?? []), ...(jrrb.data ?? [])].filter(r => {
    const k = `${r.level}-${r.title}`; if (rSeen.has(k)) return false; rSeen.add(k); return true
  })
  return { recommended, race }
}

// ── 메인 앱 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState('idle')           // idle | loading | result
  const [showCamera, setShowCamera] = useState(false)
  const [showIsbnInput, setShowIsbnInput] = useState(false)
  const [isbn, setIsbn] = useState('')
  const [bookData, setBookData] = useState(null)
  const [lists, setLists] = useState(null)
  const [noBookInfo, setNoBookInfo] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [descExpanded, setDescExpanded] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bc_favorites')) || [] } catch { return [] }
  })
  const [bookFavorites, setBookFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bc_book_favorites')) || [] } catch { return [] }
  })
  const [favResults, setFavResults] = useState({})
  const [favLoading, setFavLoading] = useState(false)
  const [nearbyLibs, setNearbyLibs] = useState([])
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyError, setNearbyError] = useState('')
  const [libSearchQuery, setLibSearchQuery] = useState('')
  const [libSearchResults, setLibSearchResults] = useState([])
  const [libSearchLoading, setLibSearchLoading] = useState(false)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bc_history')) || [] } catch { return [] }
  })
  const [showHistory, setShowHistory] = useState(false)

  const currentIsbnRef = useRef('')
  const currentTitleRef = useRef('')
  const isbnInputRef = useRef(null)

  // ISBN 입력창 열리면 포커스
  useEffect(() => {
    if (showIsbnInput) isbnInputRef.current?.focus()
  }, [showIsbnInput])

  const addHistory = useCallback((info, isbnVal) => {
    if (!info?.title) return
    setHistory(prev => {
      const filtered = prev.filter(h => h.isbn !== isbnVal)
      const next = [{ isbn: isbnVal, title: info.title, author: info.author, thumbnail: info.thumbnail, ts: Date.now() }, ...filtered].slice(0, 10)
      localStorage.setItem('bc_history', JSON.stringify(next))
      return next
    })
  }, [])

  const doSearch = useCallback(async (isbnVal) => {
    const clean = (isbnVal || isbn).replace(/-/g, '').trim()
    if (!clean) return

    currentIsbnRef.current = clean
    currentTitleRef.current = ''
    setMode('loading')
    setBookData(null)
    setLists(null)
    setNoBookInfo(false)
    setActiveTab(0)
    setDescExpanded(false)
    setFavResults({})
    setNearbyLibs([])
    setNearbyError('')
    setManualTitle('')
    setShowIsbnInput(false)

    // 1) ISBN으로 DB 직접 조회
    const direct = await searchByIsbn(clean)
    if (direct.recommended.length > 0 || direct.race.length > 0) {
      // 외부 API로 책 정보 가져오기 (실패 시 DB 정보로 폴백)
      const info = await fetchBookInfo(clean)
      const dbEntry = direct.recommended[0] || direct.race[0]
      const bookInfo = info ?? (dbEntry ? {
        title: dbEntry.title ?? '',
        author: dbEntry.author ?? '',
        thumbnail: '',
        description: '',
        publisher: '',
        pubdate: '',
        link: '',
        price: '',
        isbn: clean,
        source: 'db',
      } : null)
      if (bookInfo) {
        setBookData(bookInfo)
        currentTitleRef.current = bookInfo.title
        addHistory(bookInfo, clean)
      }
      setLists(direct)
      setMode('result')
      return
    }

    // 2) 외부 API로 책 정보 조회 후 제목으로 DB 검색
    const info = await fetchBookInfo(clean)
    if (info) {
      setBookData(info)
      currentTitleRef.current = info.title
      addHistory(info, clean)
      const res = await searchLists(info.title)
      setLists(res)
    } else {
      setNoBookInfo(true)
    }
    setMode('result')
  }, [isbn, addHistory])

  const doManualSearch = useCallback(async () => {
    const q = manualTitle.trim()
    if (!q) return
    setMode('loading')
    setLists(null)
    const res = await searchLists(q)
    setLists(res)
    setMode('result')
  }, [manualTitle])

  // 즐겨찾기 도서관 소장 확인
  const doFavCheck = useCallback(async () => {
    const isbn = currentIsbnRef.current
    if (!isbn || favorites.length === 0) return
    setFavLoading(true)
    const initState = {}
    favorites.forEach(f => { initState[f.libCode] = 'loading' })
    setFavResults(initState)
    const results = await Promise.all(
      favorites.map(async (f) => ({ libCode: f.libCode, status: await checkBookExist(f.libCode, isbn) }))
    )
    const next = {}
    results.forEach(({ libCode, status }) => { next[libCode] = status })
    setFavResults(next)
    setFavLoading(false)
  }, [favorites])

  // GPS 주변 도서관 검색 + 소장 확인
  const doNearbySearch = useCallback(async () => {
    const isbn = currentIsbnRef.current
    setNearbyLoading(true)
    setNearbyError('')
    setNearbyLibs([])
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        })
      )
      const { latitude, longitude } = pos.coords
      const libs = await fetchNearbyLibs(latitude, longitude)
      setNearbyLibs(libs.map(l => ({ ...l, status: 'loading' })))
      setNearbyLoading(false)
      if (isbn) {
        const results = await Promise.all(
          libs.map(async (l) => ({ libCode: l.libCode, status: await checkBookExist(l.libCode, isbn) }))
        )
        setNearbyLibs(prev =>
          prev
            .map(l => {
              const found = results.find(r => r.libCode === l.libCode)
              return found ? { ...l, status: found.status } : l
            })
            .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
        )
      } else {
        setNearbyLibs(libs.map(l => ({ ...l, status: null })).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)))
      }
    } catch (e) {
      setNearbyLoading(false)
      if (e.code === 1) setNearbyError('위치 접근 권한이 거부되었어요.\n브라우저 설정에서 허용해주세요.')
      else setNearbyError('위치를 가져오는 데 실패했어요. 다시 시도해주세요.')
    }
  }, [])

  const toggleBookFavorite = useCallback(() => {
    if (!bookData) return
    setBookFavorites(prev => {
      const exists = prev.find(b => b.isbn === bookData.isbn)
      const next = exists
        ? prev.filter(b => b.isbn !== bookData.isbn)
        : [...prev, { isbn: bookData.isbn, title: bookData.title, author: bookData.author, thumbnail: bookData.thumbnail }]
      localStorage.setItem('bc_book_favorites', JSON.stringify(next))
      return next
    })
  }, [bookData])

  const doLibSearch = useCallback(async () => {
    if (!libSearchQuery.trim()) return
    setLibSearchLoading(true)
    setLibSearchResults([])
    try {
      const res = await fetch(`/api/lib-name-search?name=${encodeURIComponent(libSearchQuery.trim())}`)
      const data = await res.json()
      const libs = (data?.response?.libs ?? []).map(({ lib }) => ({
        libCode: lib.libCode,
        libName: lib.libName,
        address: lib.address ?? '',
      }))
      setLibSearchResults(libs)
    } catch { setLibSearchResults([]) }
    setLibSearchLoading(false)
  }, [libSearchQuery])

  const toggleFavorite = useCallback((lib) => {
    setFavorites(prev => {
      const exists = prev.find(f => f.libCode === lib.libCode)
      const next = exists
        ? prev.filter(f => f.libCode !== lib.libCode)
        : [...prev, { libCode: lib.libCode, libName: lib.libName, address: lib.address }]
      localStorage.setItem('bc_favorites', JSON.stringify(next))
      return next
    })
  }, [])

  const handleDetected = useCallback((val) => {
    setShowCamera(false)
    setIsbn(val)
    doSearch(val)
  }, [doSearch])

  const handleHistoryItem = useCallback((item) => {
    setShowHistory(false)
    setIsbn(item.isbn)
    doSearch(item.isbn)
  }, [doSearch])

  // 탭 인디케이터 위치
  const tabCount = 2
  const tabIndicatorLeft = `${(activeTab / tabCount) * 100}%`
  const tabIndicatorWidth = `${100 / tabCount}%`

  return (
    <div className="app">
      {/* ── 헤더 ── */}
      <header className="app-header">
        <div className="header-logo">
          <div className="header-logo-mark">B</div>
          <div className="header-logo-text">
            <span className="header-logo-sub">BOOK CHECKER</span>
            <span className="header-logo-main">책 스캐너 v2</span>
          </div>
        </div>
        <button
          className={`header-btn ${showHistory ? 'active' : ''}`}
          onClick={() => setShowHistory(v => !v)}
          title="최근 스캔"
        >
          🕐
        </button>
      </header>

      {/* ── 메인 ── */}
      <main className="app-main">

        {/* 아이들 화면 */}
        {mode === 'idle' && (
          <div className="idle-hero">
            {/* 로고 */}
            <img
              src="/logo.png"
              alt="책 스캐너 로고"
              style={{ width: 72, height: 72, objectFit: 'contain', marginBottom: 8 }}
            />

            {/* 레이더 애니메이션 */}
            <div className="idle-radar-wrap">
              <div className="idle-radar-ring" />
              <div className="idle-radar-ring" />
              <div className="idle-radar-ring" />
              <button className="idle-radar-center" onClick={() => setShowCamera(true)}>
                <span className="idle-radar-icon">📷</span>
              </button>
            </div>

            <div className="idle-eyebrow">BOOK CHECKER</div>
            <h1 className="idle-title">책을 스캔해요</h1>
            <p className="idle-sub">
              바코드를 스캔하거나 ISBN을 입력하면<br/>
              추천도서·리딩레이스 목록과<br/>
              도서관 소장 여부를 확인해드려요
            </p>
            {bookFavorites.length > 0 && (
              <>
                <div className="idle-divider" />
                <div style={{ width: '100%' }}>
                  <div className="history-label">⭐ 즐겨찾기 책</div>
                  <div className="history-scroll">
                    {bookFavorites.map((b, i) => (
                      <div key={i} className="history-card" onClick={() => doSearch(b.isbn)}>
                        {b.thumbnail
                          ? <img src={b.thumbnail} alt="" className="history-thumb" />
                          : <div className="history-thumb-placeholder">📚</div>
                        }
                        <div className="history-card-title">{b.title}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            {history.length > 0 && (
              <>
                <div className="idle-divider" />
                <div style={{ width: '100%' }}>
                  <div className="history-label">RECENT</div>
                  <div className="history-scroll">
                    {history.map((h, i) => (
                      <div key={i} className="history-card" onClick={() => handleHistoryItem(h)}>
                        {h.thumbnail
                          ? <img src={h.thumbnail} alt="" className="history-thumb" />
                          : <div className="history-thumb-placeholder">📚</div>
                        }
                        <div className="history-card-title">{h.title}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 로딩 스켈레톤 */}
        {mode === 'loading' && (
          <div>
            <div className="skeleton-card">
              <div style={{ display: 'flex', gap: 16 }}>
                <div className="skel skel-cover" />
                <div style={{ flex: 1 }}>
                  <div className="skel skel-line lg" style={{ marginBottom: 10 }} />
                  <div className="skel skel-line md" style={{ marginBottom: 8 }} />
                  <div className="skel skel-line sm" />
                </div>
              </div>
            </div>
            <div className="skeleton-card">
              <div className="skel skel-line" style={{ marginBottom: 10, width: '40%' }} />
              <div className="skel skel-line" style={{ marginBottom: 8 }} />
              <div className="skel skel-line" style={{ width: '80%', marginBottom: 8 }} />
              <div className="skel skel-line" style={{ width: '65%' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
              <div className="spinner" />
            </div>
          </div>
        )}

        {/* 결과 화면 */}
        {mode === 'result' && (
          <div className="book-result">

            {/* 책 정보 히어로 카드 */}
            {bookData && (
              <div className="book-hero">
                <div className="book-cover-wrap">
                  {bookData.thumbnail
                    ? <img src={bookData.thumbnail} alt="표지" className="book-cover" />
                    : <div className="book-cover-placeholder">📚</div>
                  }
                </div>
                <div className="book-meta">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="book-source-badge">
                      {bookData.source === 'lib' ? '도서관' : bookData.source === 'db' ? '목록DB' : 'Google Books'}
                    </span>
                    <button
                      onClick={toggleBookFavorite}
                      title={bookFavorites.some(b => b.isbn === bookData.isbn) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                      style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: '0 4px' }}
                    >
                      {bookFavorites.some(b => b.isbn === bookData.isbn) ? '⭐' : '☆'}
                    </button>
                  </div>
                  <div className="book-title">{bookData.title}</div>
                  <div className="book-author">{bookData.author}</div>
                  <div className="book-tags">
                    {bookData.publisher && <span className="book-tag">{bookData.publisher}</span>}
                    {bookData.pubdate && <span className="book-tag">{bookData.pubdate}</span>}
                    {bookData.price && <span className="book-tag">{bookData.price}</span>}
                  </div>
                </div>
              </div>
            )}

            {/* 책 정보를 못 찾은 경우 */}
            {noBookInfo && !bookData && (
              <div style={{
                background: 'var(--card)', border: '1px solid rgba(201,169,110,0.3)',
                borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 12,
              }}>
                <div style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600, marginBottom: 10 }}>
                  ⚠️ 책 정보를 찾지 못했어요. 제목으로 검색해보세요.
                </div>
                <div className="manual-search-row">
                  <input
                    className="manual-search-input"
                    value={manualTitle}
                    onChange={e => setManualTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && doManualSearch()}
                    placeholder="책 제목을 입력하세요"
                  />
                  <button className="manual-search-btn" onClick={doManualSearch} disabled={!manualTitle.trim()}>
                    검색
                  </button>
                </div>
              </div>
            )}

            {/* 책 설명 */}
            {bookData?.description && (
              <div className="book-desc-card">
                <div className="book-desc-label">DESCRIPTION</div>
                <div className={`book-desc-text ${descExpanded ? '' : 'collapsed'}`}>
                  {bookData.description}
                </div>
                <button className="book-desc-toggle" onClick={() => setDescExpanded(v => !v)}>
                  {descExpanded ? '접기 ▲' : '더보기 ▼'}
                </button>
              </div>
            )}

            {/* 네이버 링크 */}
            {bookData?.link && (
              <a className="book-naver-link" href={bookData.link} target="_blank" rel="noopener noreferrer">
                <span>🔗</span>
                <span>네이버 책 상세 페이지</span>
              </a>
            )}

            {/* 리딩레이스 인라인 표시 (해당될 때만) */}
            {lists !== null && lists.race.length > 0 && (
              <div className="list-section">
                <div className="list-section-header">
                  <span className="list-status-icon">✅</span>
                  <span className="list-section-title">리딩레이스 목록</span>
                  <span className="list-section-count">{lists.race.length}건</span>
                </div>
                {lists.race.map((r, i) => (
                  <div key={i} className="list-item">
                    {r.level && <span className="list-badge race">{r.level}단계</span>}
                    <div>
                      <div className="list-item-title">{r.title}</div>
                      {r.author && <div className="list-item-author">{r.author}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 탭 */}
            {lists !== null && (
              <div className="tabs-wrap">
                <div className="tabs-header">
                  {['도서관 소장', '도서 검색'].map((label, i) => (
                    <button key={i} className={`tab-btn ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
                      {label}
                    </button>
                  ))}
                  <div className="tab-indicator" style={{ left: tabIndicatorLeft, width: tabIndicatorWidth }} />
                </div>

                <div className="tab-content">

                  {/* 탭 0: 도서관 소장 */}
                  {activeTab === 0 && (
                    <div>

                      {/* 도서관 검색으로 즐겨찾기 추가 */}
                      <div className="lib-section">
                        <div className="lib-section-header">
                          <span className="lib-section-title">🔍 도서관 검색</span>
                        </div>
                        <div className="manual-search-row">
                          <input
                            className="manual-search-input"
                            value={libSearchQuery}
                            onChange={e => setLibSearchQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && doLibSearch()}
                            placeholder="도서관 이름 입력 (예: 용인)"
                          />
                          <button
                            className="manual-search-btn"
                            onClick={doLibSearch}
                            disabled={libSearchLoading || !libSearchQuery.trim()}
                          >
                            {libSearchLoading ? '…' : '검색'}
                          </button>
                        </div>
                        {libSearchResults.map(lib => {
                          const isFav = favorites.some(f => f.libCode === lib.libCode)
                          return (
                            <div key={lib.libCode} className="lib-nearby-item">
                              <div className="lib-nearby-info">
                                <div className="lib-nearby-name">{lib.libName}</div>
                                {lib.address && <div className="lib-nearby-addr">{lib.address}</div>}
                              </div>
                              <button
                                className={`lib-fav-btn ${isFav ? 'active' : ''}`}
                                onClick={() => toggleFavorite(lib)}
                                title={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                              >
                                {isFav ? '⭐' : '☆'}
                              </button>
                            </div>
                          )
                        })}
                      </div>

                      {/* 즐겨찾기 섹션 */}
                      {favorites.length > 0 && (
                        <div className="lib-section">
                          <div className="lib-section-header">
                            <span className="lib-section-title">⭐ 즐겨찾기</span>
                            <button
                              className="lib-fav-check-btn"
                              onClick={doFavCheck}
                              disabled={favLoading || !currentIsbnRef.current}
                            >
                              {favLoading ? '조회 중…' : '소장 확인'}
                            </button>
                          </div>
                          {favorites.map(fav => {
                            const status = favResults[fav.libCode]
                            const s = status ? (LIB_STATUS[status] || LIB_STATUS.error) : null
                            return (
                              <div key={fav.libCode} className="lib-nearby-item">
                                <div className="lib-nearby-info">
                                  <div className="lib-nearby-name">{fav.libName}</div>
                                  {fav.address && <div className="lib-nearby-addr">{fav.address}</div>}
                                </div>
                                <div className="lib-nearby-actions">
                                  {s && <span className={`lib-badge ${s.cls}`}>{s.label}</span>}
                                  <button className="lib-fav-btn active" onClick={() => toggleFavorite(fav)} title="즐겨찾기 해제">⭐</button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* 주변 도서관 섹션 */}
                      <div className="lib-section">
                        <div className="lib-section-header">
                          <span className="lib-section-title">📍 내 주변 도서관</span>
                          <span className="lib-section-hint">5km 이내</span>
                        </div>
                        <button
                          className="lib-nearby-btn"
                          onClick={doNearbySearch}
                          disabled={nearbyLoading}
                        >
                          {nearbyLoading ? '위치 확인 중…' : '📍 주변 도서관 찾기'}
                        </button>
                        {nearbyError && (
                          <div className="lib-error">{nearbyError}</div>
                        )}
                        {[...nearbyLibs].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)).map(lib => {
                          const s = lib.status ? (LIB_STATUS[lib.status] || LIB_STATUS.error) : null
                          const isFav = favorites.some(f => f.libCode === lib.libCode)
                          return (
                            <div key={lib.libCode} className="lib-nearby-item">
                              <div className="lib-nearby-info">
                                <div className="lib-nearby-name">{lib.libName}</div>
                                <div className="lib-nearby-addr">
                                  <span className="lib-dist-badge">{lib.distance.toFixed(1)}km</span>
                                  {lib.address}
                                </div>
                              </div>
                              <div className="lib-nearby-actions">
                                {s && <span className={`lib-badge ${s.cls}`}>{s.label}</span>}
                                <button
                                  className={`lib-fav-btn ${isFav ? 'active' : ''}`}
                                  onClick={() => toggleFavorite(lib)}
                                  title={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                                >
                                  {isFav ? '⭐' : '☆'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                        {nearbyLibs.length === 0 && !nearbyLoading && !nearbyError && (
                          <div className="lib-empty-hint">
                            버튼을 누르면 주변 도서관을 찾아드려요
                          </div>
                        )}
                      </div>

                    </div>
                  )}

                  {/* 탭 1: 도서 검색 */}
                  {activeTab === 1 && (
                    <div>
                      <div className="manual-search-label">제목 또는 ISBN으로 검색</div>
                      <div className="manual-search-row">
                        <input
                          className="manual-search-input"
                          value={manualTitle}
                          onChange={e => setManualTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key !== 'Enter') return
                            const v = manualTitle.trim().replace(/-/g, '')
                            if (/^97[89]\d{10}$/.test(v)) doSearch(v)
                            else doManualSearch()
                          }}
                          placeholder="책 제목 또는 ISBN 입력"
                        />
                        <button
                          className="manual-search-btn"
                          onClick={() => {
                            const v = manualTitle.trim().replace(/-/g, '')
                            if (/^97[89]\d{10}$/.test(v)) doSearch(v)
                            else doManualSearch()
                          }}
                          disabled={!manualTitle.trim()}
                        >
                          검색
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* 결과 나온 후 처음으로 버튼 */}
            <div style={{ textAlign: 'center', paddingTop: 8 }}>
              <button
                onClick={() => { setMode('idle'); setBookData(null); setLists(null); setIsbn(''); }}
                style={{
                  fontSize: 12, color: 'var(--text-3)', padding: '8px 16px',
                  border: '1px solid var(--border)', borderRadius: 20,
                  transition: 'color 0.2s, border-color 0.2s',
                }}
              >
                처음으로
              </button>
            </div>
          </div>
        )}

      </main>

      {/* ── 하단 고정 푸터 ── */}
      <footer className="app-footer">
        {showIsbnInput && (
          <div className="isbn-panel">
            <input
              ref={isbnInputRef}
              className="isbn-input"
              value={isbn}
              onChange={e => setIsbn(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              placeholder="ISBN 번호 입력 (예: 9788936434120)"
              inputMode="numeric"
            />
            <button
              className="isbn-search-btn"
              onClick={() => doSearch()}
              disabled={mode === 'loading' || !isbn.trim()}
            >
              조회
            </button>
          </div>
        )}
        <div className="bottom-bar">
          <button
            className={`bottom-side-btn ${showIsbnInput ? 'active' : ''}`}
            onClick={() => setShowIsbnInput(v => !v)}
            title="ISBN 입력"
          >
            ⌨️
          </button>
          <button
            className="scan-btn"
            onClick={() => setShowCamera(true)}
            disabled={showCamera}
          >
            <span className="scan-btn-ring" />
            📷
          </button>
        </div>
      </footer>

      {/* ── 카메라 오버레이 ── */}
      {showCamera && (
        <CameraScanner
          onDetected={handleDetected}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* ── 히스토리 드로어 ── */}
      {showHistory && (
        <>
          <div className="history-overlay" onClick={() => setShowHistory(false)} />
          <div className="history-drawer">
            <div className="history-drawer-handle" />
            <div className="history-drawer-header">
              <span className="history-drawer-title">최근 스캔</span>
              {history.length > 0 && (
                <button
                  className="history-drawer-clear"
                  onClick={() => {
                    setHistory([])
                    localStorage.removeItem('bc_history')
                  }}
                >
                  전체 삭제
                </button>
              )}
            </div>
            <div className="history-drawer-list">
              {history.length === 0 ? (
                <div className="list-empty" style={{ padding: '24px 18px' }}>
                  최근 스캔 기록이 없어요
                </div>
              ) : history.map((h, i) => (
                <div key={i} className="history-drawer-item" onClick={() => handleHistoryItem(h)}>
                  {h.thumbnail
                    ? <img src={h.thumbnail} alt="" className="history-drawer-thumb" />
                    : <div className="history-drawer-thumb-ph">📚</div>
                  }
                  <div className="history-drawer-info">
                    <div className="history-drawer-item-title">{h.title}</div>
                    <div className="history-drawer-item-meta">{h.author}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
