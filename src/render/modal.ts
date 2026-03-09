import { escapeHtml, applySafeImage, getMainProb, toKSTDateString } from '../utils.ts';
import { getTitle, getLocale } from '../i18n.ts';
import { getFilteredEvents } from '../filters.ts';
import type { PolyEvent } from '../types.ts';

export function openEventLink(slug: string, searchQuery: string, eventSlug: string): void {
    if (searchQuery) {
        const encoded = encodeURIComponent(searchQuery);
        window.open(`https://polymarket.com/markets?_q=${encoded}`, '_blank');
    } else if (eventSlug) {
        window.open(`https://polymarket.com/event/${eventSlug}`, '_blank');
    } else if (slug) {
        let normalizedSlug = slug;

        const tempRangePattern = /-(\d{4})-(?:neg-)?\d+-?\d*[cf](?:orhigher|orbelow)?$/;
        const numericRangePattern = /-(\d{3,}-\d{2,})$/;
        const plusPattern = /-\d+plus$/;
        const priceAboveBelowPattern = /-(above|below)-[\d]+(?:pt\d+)?k?-on-/;
        const priceBetweenPattern = /-be-between-[\d]+(?:pt\d+)?-[\d]+(?:pt\d+)?-on-/;
        const greaterLessThanPattern = /^will-the-price-of-([^-]+)-be-(?:greater-than|less-than)-[\d]+(?:pt\d+)?-on-(.+)$/;
        const reachDipPattern = /^will-([^-]+)-(?:reach|dip-to)-[\d]+(?:pt\d+)?k?-((?:in|on|by)-.+?)(?:-\d{3}-\d{3}-\d{3})?$/;
        const trumpSayThisWeekPattern = /^will-trump-say-.+-this-week-(.+)$/;
        const robotDancersPattern = /^will-[^-]+-have-robot-dancers-at-(.+)$/;
        const stockClosePattern = /^will-([a-z]+)-close-(?:above|between)-[\d]+(?:-and-[\d]+)?-week-(.+)$/;
        const exactlyNumberPattern = /^will-there-be-exactly-\d+-(.+)$/;

        if (tempRangePattern.test(slug)) {
            normalizedSlug = slug.replace(tempRangePattern, '-$1');
        } else if (priceAboveBelowPattern.test(slug)) {
            normalizedSlug = slug.replace(/-(above|below)-[\d]+(?:pt\d+)?k?-on-/, '-$1-on-');
        } else if (priceBetweenPattern.test(slug)) {
            normalizedSlug = slug.replace(/will-the-price-of-([^-]+)-be-between-[\d]+(?:pt\d+)?-[\d]+(?:pt\d+)?-on-(.+)/, '$1-price-on-$2');
        } else if (greaterLessThanPattern.test(slug)) {
            normalizedSlug = slug.replace(greaterLessThanPattern, '$1-price-on-$2');
        } else if (reachDipPattern.test(slug)) {
            const match = slug.match(reachDipPattern);
            if (match) {
                const subject = match[1];
                const period = match[2];
                const sq = `${subject} ${period.replace(/-/g, ' ')}`;
                window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(sq)}`, '_blank');
                return;
            }
        } else if (trumpSayThisWeekPattern.test(slug)) {
            normalizedSlug = slug.replace(trumpSayThisWeekPattern, 'what-will-trump-say-this-week-$1');
        } else if (robotDancersPattern.test(slug)) {
            const match = slug.match(robotDancersPattern);
            if (match) {
                const eventName = match[1];
                const sq = `robot dancers ${eventName.replace(/-/g, ' ')}`;
                window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(sq)}`, '_blank');
                return;
            }
        } else if (stockClosePattern.test(slug)) {
            const match = slug.match(stockClosePattern);
            if (match) {
                const ticker = match[1];
                const period = match[2];
                const sq = `${ticker} close ${period.replace(/-/g, ' ')}`;
                window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(sq)}`, '_blank');
                return;
            }
        } else if (exactlyNumberPattern.test(slug)) {
            const match = slug.match(exactlyNumberPattern);
            if (match) {
                const eventName = match[1];
                const sq = eventName.replace(/-/g, ' ').replace(/pt/g, '.');
                window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(sq)}`, '_blank');
                return;
            }
        } else if (plusPattern.test(slug)) {
            normalizedSlug = slug.replace(plusPattern, '');
        } else if (numericRangePattern.test(slug)) {
            if (!/-15m-\d+$/.test(slug)) {
                normalizedSlug = slug.replace(numericRangePattern, '');
            }
        }

        window.open(`https://polymarket.com/event/${normalizedSlug}`, '_blank');
    }
}

export function showDayEvents(dateKey: string): void {
    const filtered = getFilteredEvents((document.getElementById('searchInput') as HTMLInputElement).value);
    const dayEvents = filtered.filter(e => toKSTDateString(e.end_date) === dateKey);

    const date = new Date(dateKey + 'T00:00:00');
    const dateStr = date.toLocaleDateString(getLocale(), {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Seoul'
    });

    document.getElementById('modalDate')!.textContent = `${dateStr} 만료 예정`;

    const modalBody = document.getElementById('modalBody')!;
    modalBody.innerHTML = '';

    dayEvents.forEach(event => {
        renderModalEventItem(modalBody, event);
    });

    document.getElementById('modalOverlay')!.classList.add('active');
}

function renderModalEventItem(container: HTMLElement, event: PolyEvent): void {
    const imageUrl = event.image_url || '';
    const prob = getMainProb(event);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const hasLink = slugSafe || eventSlugSafe;

    const eventEl = document.createElement('div');
    eventEl.className = `modal-event-item${!hasLink ? ' disabled' : ''}`;
    if (hasLink) {
        eventEl.onclick = () => openEventLink(slugSafe, '', eventSlugSafe);
    }
    eventEl.innerHTML = `
        <img class="modal-event-image" alt="">
        <div class="modal-event-content">
            <div class="modal-event-title">${escapeHtml(getTitle(event))}</div>
            <div class="modal-event-category">${escapeHtml(event.category || 'Uncategorized')}</div>
        </div>
        <span class="modal-event-prob ${probClass}">${prob}%</span>
    `;
    const eventImg = eventEl.querySelector('.modal-event-image') as HTMLImageElement | null;
    if (eventImg) applySafeImage(eventImg, imageUrl);
    container.appendChild(eventEl);
}

export function closeModal(): void {
    document.getElementById('modalOverlay')!.classList.remove('active');
}
