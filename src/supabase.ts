import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.ts';
import { setSupabaseClient } from './state.ts';

export function initSupabase(): void {
    if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
        console.warn('Supabase URL이 설정되지 않았습니다.');
        return;
    }
    try {
        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        setSupabaseClient(client);
        console.log('✅ Supabase 클라이언트 생성 완료');
    } catch (e) {
        console.error('❌ Supabase 클라이언트 생성 실패:', e);
    }
}
