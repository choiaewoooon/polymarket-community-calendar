// Supabase Configuration (import.meta.env 사용, fallback to hardcoded public anon key)
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || 'https://vqyoaktosbclwsuvoyjj.supabase.co';
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxeW9ha3Rvc2JjbHdzdXZveWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTQwMzIsImV4cCI6MjA4NDk3MDAzMn0.iZ6LkNfMiZEAjo-PmyY0KtXRJTn-GqKeB124RlA5Z5s';
