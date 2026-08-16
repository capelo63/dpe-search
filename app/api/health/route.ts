export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    urlHead: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30) || 'MISSING',
    keyLength: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length || 0,
    supabaseKeys: Object.keys(process.env).filter(k => k.includes('SUPABASE')),
    runtime: process.env.NEXT_RUNTIME || 'unknown',
  });
}
