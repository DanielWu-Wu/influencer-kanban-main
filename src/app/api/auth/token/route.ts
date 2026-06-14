import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: '该旧版换票接口已停用，请使用一键连接 Gmail。' },
    { status: 410 },
  );
}
