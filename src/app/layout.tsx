import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Providers from './providers'
import SiteHeader from "@/components/SiteHeader";

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Episodic',
  description: 'Your personal TV tracker',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SiteHeader />
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}