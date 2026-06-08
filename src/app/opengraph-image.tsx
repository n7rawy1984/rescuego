import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'RescueGo - UAE Roadside Recovery'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 700,
              color: 'white',
            }}
          >
            R
          </div>
          <span style={{ fontSize: '72px', fontWeight: 700, color: 'white' }}>
            RescueGo
          </span>
        </div>
        <span style={{ fontSize: '32px', color: '#E1F5EE', marginBottom: '16px' }}>
          Roadside Recovery UAE
        </span>
        <span style={{ fontSize: '22px', color: '#9FE1CB' }}>
          Trusted providers. Fast response. All emirates.
        </span>
      </div>
    ),
    { ...size }
  )
}
