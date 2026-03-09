import { currentLang } from '../i18n.ts';
import { translations, getTitle, getLocale } from '../i18n.ts';
import { categoryColors } from '../constants.ts';
import { toKSTDateString, getKSTToday, getKSTTime, getTimeClass, addDays, escapeHtml, formatCurrency, applySafeImage, getMainProb, inferCategory } from '../utils.ts';
import { getFilteredEvents } from '../filters.ts';
import { showEventTooltip, hideEventTooltip, positionTooltip } from './tooltip.ts';
import { openEventLink } from './modal.ts';
import type { PolyEvent } from '../types.ts';

export function renderWeekView(searchQuery = ''): void {
    const todayKST = getKSTToday();
    const filtered = getFilteredEvents(searchQuery);
    const nowKST = new Date();

    const weekDates: string[] = [];
    for (let i = 0; i < 5; i++) {
        weekDates.push(addDays(todayKST, i));
    }

    const eventsByDate: Record<string, PolyEvent[]> = {};
    filtered.forEach(event => {
        if (event.end_date) {
            const dateKey = toKSTDateString(event.end_date);
            if (weekDates.includes(dateKey)) {
                if (dateKey === todayKST) {
                    const eventEndTime = new Date(event.end_date);
                    if (eventEndTime > nowKST) {
                        if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
                        eventsByDate[dateKey].push(event);
                    }
                } else {
                    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
                    eventsByDate[dateKey].push(event);
                }
            }
        }
    });

    Object.keys(eventsByDate).forEach(dateKey => {
        eventsByDate[dateKey].sort((a, b) => {
            return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
        });
    });

    const weekStart = new Date(todayKST + 'T00:00:00');
    const weekEnd = new Date(addDays(todayKST, 4) + 'T00:00:00');
    const weekRangeText = `${weekStart.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })} - ${weekEnd.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })}`;
    document.getElementById('weekRange')!.textContent = weekRangeText;

    const timeline = document.getElementById('weekTimeline')!;
    timeline.innerHTML = '';

    weekDates.forEach(dateKey => {
        const dayEvents = eventsByDate[dateKey] || [];
        const date = new Date(dateKey + 'T00:00:00');
        const isToday = dateKey === todayKST;

        const dayEl = document.createElement('div');
        dayEl.className = `week-day${isToday ? ' today' : ''}`;

        const dayName = date.toLocaleDateString(getLocale(), { weekday: 'short', timeZone: 'Asia/Seoul' });
        const dayNumber = date.getDate();
        const monthName = date.toLocaleDateString(getLocale(), { month: 'short', timeZone: 'Asia/Seoul' });
        const dayDateText = currentLang === 'ko' ? `${monthName} ${dayNumber}일` : `${monthName} ${dayNumber}`;

        dayEl.innerHTML = `
            <div class="week-day-header">
                <div class="week-day-name">${dayName}</div>
                <div class="week-day-date">${dayDateText}</div>
                ${dayEvents.length > 0 ? `<div class="week-event-count">${dayEvents.length}${translations[currentLang].events}</div>` : ''}
            </div>
            <div class="week-day-events" id="week-${dateKey}"></div>
        `;

        timeline.appendChild(dayEl);

        const eventsContainer = document.getElementById(`week-${dateKey}`)!;
        if (dayEvents.length === 0) {
            eventsContainer.innerHTML = `<div class="week-no-events">${translations[currentLang].noEvents}</div>`;
        } else {
            dayEvents.forEach(event => {
                renderWeekEventCard(eventsContainer, event);
            });
        }
    });
}

function renderWeekEventCard(container: HTMLElement, event: PolyEvent): void {
    const time = getKSTTime(event.end_date);
    const timeClass = getTimeClass(time);
    const imageUrl = event.image_url || '';
    const prob = getMainProb(event);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const volume = formatCurrency(event.volume);
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const category = inferCategory(event);
    const categoryColor = categoryColors[category] || categoryColors['default'];

    const eventEl = document.createElement('div');
    eventEl.className = 'week-event';
    eventEl.style.borderLeftColor = categoryColor;
    eventEl.setAttribute('data-category', category);
    if (event.hidden) eventEl.setAttribute('data-hidden', 'true');
    eventEl.onclick = () => openEventLink(slugSafe, '', eventSlugSafe);

    eventEl.addEventListener('mouseenter', (e) => showEventTooltip(e, event));
    eventEl.addEventListener('mousemove', (e) => positionTooltip(e));
    eventEl.addEventListener('mouseleave', hideEventTooltip);

    const safeEventId = escapeHtml(event.id);
    const adminControls = `
        <div class="admin-event-controls">
            <button class="admin-ctrl-btn" data-admin-action="edit" data-event-id="${safeEventId}" title="편집">&#9998;</button>
            <button class="admin-ctrl-btn hide-btn" data-admin-action="toggle-hidden" data-event-id="${safeEventId}" title="${event.hidden ? '노출' : '숨김'}">${event.hidden ? '&#9711;' : '&#10005;'}</button>
        </div>
    `;

    eventEl.innerHTML = `
        ${adminControls}
        <div class="week-event-time ${timeClass}">${time}</div>
        <div class="week-event-content">
            <div class="week-event-header">
                <img class="week-event-image" alt="">
                <span class="week-event-title">${escapeHtml(getTitle(event))}</span>
                <button class="event-link-btn" data-polymarket-slug="${slugSafe}" title="Open in Polymarket">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                </button>
            </div>
            <div class="week-event-meta">
                <span class="week-event-prob ${probClass}">${prob}%</span>
                <span class="week-event-volume">Vol: $${volume}</span>
            </div>
        </div>
    `;

    const eventImg = eventEl.querySelector('.week-event-image') as HTMLImageElement | null;
    if (eventImg) applySafeImage(eventImg, imageUrl);

    const linkBtn = eventEl.querySelector('.event-link-btn[data-polymarket-slug]') as HTMLElement | null;
    if (linkBtn) {
        linkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open('https://polymarket.com/event/' + linkBtn.dataset.polymarketSlug, '_blank');
        });
    }

    // Admin 컨트롤 — 이벤트 위임으로 v2OpenEditModal, v2ToggleHidden 호출
    eventEl.querySelectorAll('[data-admin-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (btn as HTMLElement).dataset.eventId!;
            if ((btn as HTMLElement).dataset.adminAction === 'edit' && window.__v2OpenEditModal) window.__v2OpenEditModal(id);
            else if ((btn as HTMLElement).dataset.adminAction === 'toggle-hidden' && window.__v2ToggleHidden) window.__v2ToggleHidden(id);
        });
    });

    container.appendChild(eventEl);
}
