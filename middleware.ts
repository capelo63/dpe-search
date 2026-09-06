import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase-middleware';

export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Tout sauf les assets statiques Next.js et les fichiers publics.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
