export default async function handler(req, res) {
  const { q } = req.query
  if (!q) return res.status(400).json({ error: 'q required' })

  try {
    const url = `https://roselib.winbook.kr/front/bookSearch/simple/list?CHKTYPEALL=ALL&CHKLENDINCLUDE=1&CHKRESERVEINCLUDE=1&SC_KEYWORD_FIRST=${encodeURIComponent(q)}&PAGE_NO=1`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://roselib.winbook.kr/' },
    })
    const text = await response.text()

    const countMatch = text.match(/검색도서\s*:\s*(\d+)건/)
    const total = countMatch ? parseInt(countMatch[1], 10) : 0

    const detailRe = /jsDetail\('(\d+)','(\d+)'\)/g
    let m
    const seen = new Set()
    const books = []
    while ((m = detailRe.exec(text)) !== null) {
      const bibSeq = m[1], itemSeq = m[2]
      if (seen.has(bibSeq)) continue
      seen.add(bibSeq)

      const chunk = text.slice(m.index, m.index + 800)
      const titleMatch = chunk.match(/board-gallery-list-title[\s\S]*?<\/strong>/)
      const writerMatch = chunk.match(/board-gallery-list-writer[^>]*>([\s\S]*?)<\/span>/)

      const titleRaw = titleMatch?.[0] ?? ''
      const title = titleRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      const statusRaw = writerMatch?.[1] ?? ''
      const status = statusRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      const available = status.includes('대출가능')

      if (title) books.push({ bibSeq, itemSeq, title, status, available })
    }

    res.status(200).json({ total, books })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
