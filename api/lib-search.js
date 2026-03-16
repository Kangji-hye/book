export default async function handler(req, res) {
  const { lat, lng, radius = 5 } = req.query
  if (!lat || !lng) return res.status(400).json({ error: 'lat, lng required' })

  const authKey = process.env.VITE_LIB_APIKEY
  if (!authKey) return res.status(500).json({ error: 'API key not configured' })

  try {
    const url = `https://www.data4library.kr/api/libSrch?authKey=${authKey}&latitude=${lat}&longitude=${lng}&radius=${radius}&format=json`
    const response = await fetch(url)
    const data = await response.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
