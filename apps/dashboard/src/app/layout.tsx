import type { Metadata, Viewport } from 'next';

import './globals.css';
import { ConsoleCleanup } from '@/components/ConsoleCleanup';
import { PwaRegister } from '@/components/PwaRegister';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';

export const metadata: Metadata = {
  title: 'Agent Nexus Gateway',
  description: 'The most advanced local AI Gateway',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Nexus' },
};

export const viewport: Viewport = {
  themeColor: '#7c3aed',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('anx-theme');var r=t==='light'?'light':(t==='dark'?'dark':(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));if(r==='light'){document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';}else{document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <ConsoleCleanup />
        <PwaRegister />
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
