function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export default async function handler(req, res) {
  const { lat, lng, radius = 5 } = req.query
  if (!lat, !lng) return res.status(400).json({ error: 'lat, lng required' })

  const authKey = process.env.VITE_LIB_APIKEY
  if (!authKey) return res.status(500).json({ error: 'API key not configured' })

  const latF = parseFloat(lat)
  const lngF = parseFloat(lng)
  const radiusF = parseFloat(radius)

  try {
    // 전체 도서관 수 먼저 확인
    const firstRes = await fetch(`https://www.data4library.kr/api/libSrch?authKey=${authKey}&format=json&pageSize=500&pageNo=1`)
    const firstData = await firstRes.json()
    const total = firstData?.response?.numFound ?? 0
    const totalPages = Math.ceil(total / 500)

    let allLibs = firstData?.response?.libs ?? []
    if (totalPages > 1) {
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          fetch(`https://www.data4library.kr/api/libSrch?authKey=${authKey}&format=json&pageSize=500&pageNo=${i + 2}`)
            .then(r => r.json())
            .then(d => d?.response?.libs ?? [])
        )
      )
      allLibs = allLibs.concat(rest.flat())
    }

    // 좌표 기반 거리 계산 후 반경 내 필터링
    const nearby = allLibs
      .map(({ lib }) => ({
        lib: {
          ...lib,
          distance: haversine(latF, lngF, parseFloat(lib.latitude), parseFloat(lib.longitude)),
        }
      }))
      .filter(({ lib }) => !isNaN(lib.distance) && lib.distance <= radiusF)
      .sort((a, b) => a.lib.distance - b.lib.distance)
      .slice(0, 20)

    res.status(200).json({ response: { libs: nearby, numFound: nearby.length } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
