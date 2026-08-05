import { NextResponse } from 'next/server';
import { getZaloManager } from '@/lib/zalo/zalo-manager';

export const dynamic = 'force-dynamic';

export async function GET() {
  const manager = getZaloManager();
  if (!manager.isConnected() && !manager.isBusy()) {
    void manager.tryAutoLogin();
  }
  return NextResponse.json({ status: manager.getStatus() });
}
