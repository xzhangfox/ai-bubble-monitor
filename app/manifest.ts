import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AI Bubble Monitor',
    short_name: 'Bubble Monitor',
    description:
      "A daily, rules-based AI bubble risk gauge built on Ray Dalio's bubble framework, Robert Shiller's valuation research, and Hyman Minsky's financial instability hypothesis.",
    start_url: '/',
    display: 'standalone',
    background_color: '#0A0A0A',
    theme_color: '#0A0A0A',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
