import { IMAGE_HOST_ALLOWLIST } from './constants.ts';
import type { PolyEvent } from './types.ts';

// ─── KST 변환 함수들 ───

export function toKSTDateString(dateInput: Date | string | undefined): string {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const kstString = date.toLocaleString('en-CA', { timeZone: 'Asia/Seoul' });
    return kstString.split(',')[0];
}

export function getKSTToday(): string {
    const now = new Date();
    const kstString = now.toLocaleString('en-CA', { timeZone: 'Asia/Seoul' });
    return kstString.split(',')[0];
}

export function getKSTNow(): Date {
    return new Date();
}

export function getKSTTime(dateInput: Date | string | undefined): string {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const kstString = date.toLocaleString('en-US', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return kstString;
}

export function getTimeClass(timeString: string): string {
    const hour = parseInt(timeString.split(':')[0]);
    if (hour >= 0 && hour < 6) return 'dawn';
    if (hour >= 6 && hour < 18) return 'day';
    return 'night';
}

export function addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getWeekRange(startDate: string, weeks: number): { start: string; end: string } {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + (weeks * 7) - 1);
    return {
        start: toKSTDateString(start),
        end: toKSTDateString(end)
    };
}

// ─── 포맷 함수들 ───

export function formatNumber(num: number): string {
    return new Intl.NumberFormat().format(num);
}

export function formatCurrency(num: number): string {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(0) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return num.toFixed(0);
}

export function truncate(str: string | null | undefined, length: number): string {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
}

// ─── HTML / 이미지 보안 ───

export function escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function highlightSearchTerm(text: string | null | undefined, searchTerm: string): string {
    if (!text || !searchTerm || searchTerm.trim() === '') {
        return escapeHtml(text);
    }
    const escapedText = escapeHtml(text);
    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

export function sanitizeImageUrl(url: string | null | undefined): string {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return '';
        if (!IMAGE_HOST_ALLOWLIST.has(parsed.host)) {
            console.warn('[image] Unknown host:', parsed.host);
        }
        return parsed.toString();
    } catch (e) {
        return '';
    }
}

export function applySafeImage(imgEl: HTMLImageElement, url: string): void {
    if (!imgEl) return;
    const safeUrl = sanitizeImageUrl(url);
    if (!safeUrl) {
        imgEl.style.display = 'none';
        return;
    }
    imgEl.src = safeUrl;
    imgEl.addEventListener('error', () => {
        imgEl.style.display = 'none';
    }, { once: true });
}

export function getMainProb(event: PolyEvent): number {
    if (!event.probs || !Array.isArray(event.probs)) return 50;
    const prob = parseFloat(String(event.probs[0]));
    return Math.round(prob * 100);
}

export function inferCategory(event: PolyEvent): string {
    return event.category || 'Uncategorized';
}
