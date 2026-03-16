import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'

const POLYFILL_URL = 'https://fastly.jsdelivr.net/npm/barcode-detector@3/dist/iife/polyfill.min.js'

function usePolyfill() {
  const [ready, setReady] = useState(() => typeof BarcodeDetector !== 'undefined')
  useEffect(() => {
    if (ready) return
    const s = document.createElement('script')
    s.src = POLYFILL_URL
    s.onload = () => setReady(true)
    document.head.appendChild(s)
  }, [ready])
  return ready
}

const CORNERS = [['top','left'],['top','right'],['bottom','left'],['bottom','right']]

export default function CameraScanner({ onDetected, onClose }) {
  const polyfillReady = usePolyfill()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const onDetectedRef = useRef(onDetected)
  useLayoutEffect(() => { onDetectedRef.current = onDetected })

  const [err, setErr] = useState('')
  const [scanning, setScanning] = useState(false)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  useEffect(() => {
    if (!polyfillReady) return
    let alive = true
    let detector

    async function init() {
      try {
        detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e'] })
      } catch {
        setErr('이 브라우저는 바코드 인식을 지원하지 않아요.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
        })
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setScanning(true)
        scan()
      } catch {
        setErr('카메라 접근 권한이 필요해요.\n브라우저 설정에서 허용해주세요.')
      }
    }

    async function scan() {
      if (!alive) return
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(scan)
        return
      }
      try {
        const barcodes = await detector.detect(videoRef.current)
        if (barcodes.length > 0) {
          const val = barcodes[0].rawValue
          if (/^97[89]\d{10}$/.test(val) || /^\d{10}$/.test(val)) {
            stop()
            onDetectedRef.current(val)
            return
          }
        }
      } catch { /* ignore */ }
      rafRef.current = requestAnimationFrame(scan)
    }

    init()
    return () => { alive = false; stop() }
  }, [polyfillReady, stop])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(4, 4, 10, 0.96)',
      backdropFilter: 'blur(4px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '10px', letterSpacing: '0.22em', color: 'var(--gold)', fontWeight: 700, marginBottom: '3px', opacity: 0.8 }}>
              SCANNING
            </div>
            <div style={{ color: 'var(--text-1)', fontSize: '15px', fontWeight: 600 }}>
              바코드를 가운데에 맞춰주세요
            </div>
          </div>
          <button
            onClick={() => { stop(); onClose() }}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text-2)', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s',
            }}
          >✕</button>
        </div>

        {err ? (
          <div style={{
            background: 'var(--red-dim)', border: '1px solid var(--red)',
            borderRadius: 'var(--radius)', padding: '20px',
            color: 'var(--red)', fontSize: '14px',
            textAlign: 'center', lineHeight: 1.7,
            whiteSpace: 'pre-line',
          }}>{err}</div>
        ) : (
          <>
            {/* 카메라 뷰 */}
            <div style={{
              position: 'relative', borderRadius: 'var(--radius)',
              overflow: 'hidden', background: '#000', aspectRatio: '4/3',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}>
              <video
                ref={videoRef} muted playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {/* 오버레이 */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                {/* 어두운 영역 */}
                <div style={{
                  width: '78%', height: '30%', position: 'relative',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                }}>
                  {/* 스캔 라인 */}
                  {scanning && (
                    <div style={{
                      position: 'absolute', left: 0, right: 0,
                      height: '2px',
                      background: 'linear-gradient(90deg, transparent, var(--gold), transparent)',
                      animation: 'scanLine 2s ease-in-out infinite',
                    }} />
                  )}
                  {/* 모서리 */}
                  {CORNERS.map(([v, h], i) => (
                    <div key={i} style={{
                      position: 'absolute', [v]: -1, [h]: -1,
                      width: 22, height: 22,
                      borderTop: v === 'top' ? '3px solid var(--gold-light)' : 'none',
                      borderBottom: v === 'bottom' ? '3px solid var(--gold-light)' : 'none',
                      borderLeft: h === 'left' ? '3px solid var(--gold-light)' : 'none',
                      borderRight: h === 'right' ? '3px solid var(--gold-light)' : 'none',
                      borderRadius:
                        v==='top' && h==='left' ? '3px 0 0 0'
                        : v==='top' && h==='right' ? '0 3px 0 0'
                        : v==='bottom' && h==='left' ? '0 0 0 3px' : '0 0 3px 0',
                    }} />
                  ))}
                </div>
              </div>
              {/* 스캔 중 뱃지 */}
              {scanning && (
                <div style={{
                  position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center',
                }}>
                  <span style={{
                    background: 'rgba(0,0,0,0.65)', color: 'var(--gold)',
                    padding: '5px 16px', borderRadius: 20,
                    fontSize: 12, fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                  }}>스캔 중…</span>
                </div>
              )}
            </div>
            <p style={{
              color: 'var(--text-3)', textAlign: 'center',
              fontSize: 12, marginTop: 14, lineHeight: 1.7,
            }}>
              책 뒷면의 EAN-13 / ISBN 바코드를 비춰주세요
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes scanLine {
          0%   { top: 0%; opacity: 1; }
          50%  { top: 100%; opacity: 1; }
          51%  { opacity: 0; top: 100%; }
          52%  { opacity: 0; top: 0%; }
          53%  { opacity: 1; top: 0%; }
          100% { top: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  )
}
