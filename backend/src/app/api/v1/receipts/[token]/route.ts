import { NextResponse } from 'next/server';
import { wrap } from '@/core/http/wrap';
import { rentReceiptsService } from '@/modules/rent/rent-receipts.service';

/**
 * Public on purpose: the signed, five-minute token in the path is the credential, so a phone can hand the link to its PDF viewer
 * or browser. Anything wrong with the token (forged, expired, or for a reversed payment) is a plain 404.
 */
export const GET = wrap(async (ctx) => {
  const { filename, bytes } = await rentReceiptsService.render(ctx.params.token ?? '');
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(bytes.length) },
  });
});
