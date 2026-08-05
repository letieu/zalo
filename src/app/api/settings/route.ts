import { NextRequest, NextResponse } from 'next/server';
import { dbQueries } from '@/lib/db/sqlite';
import { AppSettings } from '@/types';

export async function GET() {
  try {
    const settings = dbQueries.getSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Error getting settings:', error);
    return NextResponse.json({ error: 'Failed to get settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<AppSettings>;
    dbQueries.updateSettings(body);
    const updatedSettings = dbQueries.getSettings();
    return NextResponse.json({ settings: updatedSettings });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
