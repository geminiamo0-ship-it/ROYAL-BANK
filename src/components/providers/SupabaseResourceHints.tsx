'use client';

import ReactDOM from 'react-dom';

export function SupabaseResourceHints() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (supabaseUrl) {
    ReactDOM.preconnect(supabaseUrl, { crossOrigin: 'anonymous' });
    ReactDOM.prefetchDNS(supabaseUrl);
  }

  return null;
}
