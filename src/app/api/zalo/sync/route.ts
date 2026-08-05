import { NextResponse } from 'next/server';
import { getZaloManager } from '@/lib/zalo/zalo-manager';

export async function POST() {
  const manager = getZaloManager();
  if (!manager.isConnected()) {
    return NextResponse.json({ error: 'Zalo chưa kết nối' }, { status: 409 });
  }
  try {
    const result = await manager.syncConversations();
    return NextResponse.json(result);
  } catch (err) {
    console.error('Zalo sync failed:', err);
    return NextResponse.json({ error: 'Đồng bộ Zalo thất bại' }, { status: 500 });
  }
}
