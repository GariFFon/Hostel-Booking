import { NextResponse } from 'next/server';
import { buildOpenApiDocument } from '@/core/openapi/registry';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await buildOpenApiDocument(), { headers: { 'Cache-Control': 'public, max-age=60' } });
}
