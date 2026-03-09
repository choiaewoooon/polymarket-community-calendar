import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabaseClient } from './state.ts';

export async function adminSignIn(email: string, password: string) {
    const { data, error } = await supabaseClient!.auth.signInWithPassword({
        email: email,
        password: password
    });
    if (error) throw error;
    return data;
}

export async function adminSignOut(): Promise<void> {
    const { error } = await supabaseClient!.auth.signOut();
    if (error) throw error;
}

export async function getAdminSession(): Promise<Session | null> {
    const { data: { session } } = await supabaseClient!.auth.getSession();
    return session;
}

export function onAdminAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): void {
    supabaseClient!.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}
