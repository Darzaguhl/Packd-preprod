import type { Metadata } from 'next'
import './globals.css'
import AiAssistantWrapper from '@/components/AiAssistantWrapper'

export const metadata: Metadata = {
  title: 'Packd',
  description: 'Boutique fitness studio management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AiAssistantWrapper />
      </body>
    </html>
  )
}
