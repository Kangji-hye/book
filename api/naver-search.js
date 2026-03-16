export default async function handler(req, res) {
  const { query } = req.query
  if (!query) return res.status(400).json({ error: 'query required' })

  const clientId = process.env.VITE_NAVER_CLIENT_ID
  const clientSecret = process.env.VITE_NAVER_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Naver API keys not configured' })
  }

  try {
    const response = await fetch(
      `https://openapi.naver.com/v1/search/book_adv.json?d_isbn=${encodeURIComponent(query)}&display=1`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
      }
    )
    const data = await response.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
