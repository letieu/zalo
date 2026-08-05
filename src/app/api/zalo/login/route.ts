import { NextResponse } from 'next/server';
import { getZaloManager } from '@/lib/zalo/zalo-manager';

export async function POST() {
  const manager = getZaloManager();
  const result = await manager.startQRLogin();
  return NextResponse.json(result);
}
