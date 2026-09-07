import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { SupabaseResourceHints } from '@/components/providers/SupabaseResourceHints';

export const metadata: Metadata = {
  title: 'Royal Bank — Medical Question Bank & Revision Platform',
  description: 'Comprehensive medical question bank and learning platform for MRCP, MRCOG, and post-graduate medical qualifications.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-blue-500 selection:text-white">
        <SupabaseResourceHints />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            {children}
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
