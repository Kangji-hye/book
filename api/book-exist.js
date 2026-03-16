export default async function handler(req, res) {
  const { libCode, isbn } = req.query
  if (!libCode || !isbn) return res.status(400).json({ error: 'libCode, isbn required' })

  const authKey = process.env.VITE_LIB_APIKEY
  if (!authKey) return res.status(500).json({ error: 'API key not configured' })

  try {
    const url = `https://www.data4library.kr/api/bookExist?authKey=${authKey}&libCode=${libCode}&isbn13=${isbn}&format=json`
    const response = await fetch(url)
    const data = await response.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
