// Cache keys
export const CACHE_KEY = 'polymarket_events_cache';
export const CACHE_TIME_KEY = 'polymarket_cache_time';
export const CACHE_DURATION = 5 * 60 * 1000; // 5분

// Category to Emoji mapping
export const categoryEmojis: Record<string, string> = {
    'Sports': '⚽',
    'Crypto': '💰',
    'Politics': '🏛️',
    'Pop Culture': '🎬',
    'Science': '🔬',
    'Business': '💼',
    'Technology': '💻',
    'Gaming': '🎮',
    'Music': '🎵',
    'default': '📊'
};

// Category to Color mapping
export const categoryColors: Record<string, string> = {
    'Sports': '#3b82f6',
    'Crypto': '#f59e0b',
    'Politics': '#ef4444',
    'Pop Culture': '#ec4899',
    'Science': '#10b981',
    'Business': '#8b5cf6',
    'Technology': '#06b6d4',
    'Gaming': '#f97316',
    'Finance': '#6366f1',
    'Music': '#d946ef',
    'Uncategorized': '#6b7280',
    'default': '#6b7280'
};

// Known image hosts
export const IMAGE_HOST_ALLOWLIST = new Set([
    'polymarket-upload.s3.us-east-2.amazonaws.com',
    'cdn.pandascore.co'
]);
