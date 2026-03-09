import { calendarOverviewStartWeek } from '../state.ts';
import { categoryColors } from '../constants.ts';
import { toKSTDateString, getKSTToday, addDays, escapeHtml, applySafeImage, getMainProb, truncate, inferCategory } from '../utils.ts';
import { translations, currentLang, getTitle, getLocale } from '../i18n.ts';
import { getFilteredEvents } from '../filters.ts';
import { showEventTooltip, hideEventTooltip, positionTooltip } from './tooltip.ts';
import { openEventLink, showDayEvents } from './modal.ts';
import type { PolyEvent } from '../types.ts';

export function renderCalendarOverview(searchQuery = ''): void {
    const todayKST = getKSTToday();
    const filtered = getFilteredEvents(searchQuery);

    const startDate = addDays(todayKST, 5 + (calendarOverviewStartWeek * 7));

    const weekDates: string[] = [];
    for (let i = 0; i < 21; i++) {
        weekDates.push(addDays(startDate, i));
    }

    const eventsByDate: Record<string, PolyEvent[]> = {};
    filtered.forEach(event => {
        if (event.end_date) {
            const dateKey = toKSTDateString(event.end_date);
            if (weekDates.includes(dateKey)) {
                if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
                eventsByDate[dateKey].push(event);
            }
        }
    });

    const rangeStart = new Date(startDate + 'T00:00:00');
    const rangeEnd = new Date(addDays(startDate, 20) + 'T00:00:00');
    const rangeText = `${rangeStart.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })} - ${rangeEnd.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })}`;
    document.getElementById('calendarRange')!.textContent = rangeText;

    const daysContainer = document.getElementById('calendarOverviewDays')!;
    daysContainer.innerHTML = '';

    let previousMonth: number | null = null;
    weekDates.forEach(dateKey => {
        const dayEvents = eventsByDate[dateKey] || [];
        const date = new Date(dateKey + 'T00:00:00');
        const isToday = dateKey === todayKST;

        const dayEl = document.createElement('div');
        dayEl.className = `calendar-overview-day${isToday ? ' today' : ''}`;

        const dayNumber = date.getDate();
        const currentMonth = date.getMonth();

        const isNewMonth = previousMonth !== null && previousMonth !== currentMonth;
        previousMonth = currentMonth;

        let monthLabel = '';
        if (isNewMonth || dayNumber === 1) {
            const monthName = date.toLocaleDateString(getLocale(), { month: 'short', timeZone: 'Asia/Seoul' });
            monthLabel = `<div class="calendar-overview-month-label">${monthName}</div>`;
        }

        const sortedEvents = [...dayEvents].sort((a, b) => (parseFloat(String(b.volume)) || 0) - (parseFloat(String(a.volume)) || 0));
        const topEvents = sortedEvents.slice(0, 3);

        dayEl.innerHTML = `
            ${monthLabel}
            <div class="calendar-overview-day-number">${dayNumber}</div>
            ${topEvents.length > 0 ? '<div class="calendar-overview-events"></div>' : ''}
            ${dayEvents.length > 3 ? `<div class="calendar-overview-more-link" data-date-key="${escapeHtml(dateKey)}">+${dayEvents.length - 3} ${translations[currentLang].more}</div>` : ''}
        `;

        daysContainer.appendChild(dayEl);

        const moreLink = dayEl.querySelector('.calendar-overview-more-link[data-date-key]') as HTMLElement | null;
        if (moreLink) {
            moreLink.addEventListener('click', () => {
                showDayEvents(moreLink.dataset.dateKey!);
            });
        }

        if (topEvents.length > 0) {
            const eventsContainer = dayEl.querySelector('.calendar-overview-events')!;
            topEvents.forEach(event => {
                renderOverviewEventItem(eventsContainer as HTMLElement, event);
            });
        }
    });
}

function renderOverviewEventItem(container: HTMLElement, event: PolyEvent): void {
    const imageUrl = event.image_url || '';
    const prob = getMainProb(event);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const title = truncate(getTitle(event), 25);
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const category = inferCategory(event);
    const categoryColor = categoryColors[category] || categoryColors['default'];

    const eventEl = document.createElement('div');
    eventEl.className = 'calendar-overview-event';
    eventEl.dataset.category = category;
    if (event.hidden) eventEl.setAttribute('data-hidden', 'true');
    eventEl.style.borderLeftColor = categoryColor;
    eventEl.onclick = (e) => { e.stopPropagation(); openEventLink(slugSafe, '', eventSlugSafe); };

    eventEl.addEventListener('mouseenter', (e) => showEventTooltip(e, event));
    eventEl.addEventListener('mousemove', (e) => positionTooltip(e));
    eventEl.addEventListener('mouseleave', hideEventTooltip);

    const safeEventId = escapeHtml(event.id);
    const adminHtml = `
        <div class="admin-event-controls overview-admin-controls">
            <button class="admin-ctrl-btn" data-admin-action="edit" data-event-id="${safeEventId}" title="편집">&#9998;</button>
            <button class="admin-ctrl-btn hide-btn" data-admin-action="toggle-hidden" data-event-id="${safeEventId}" title="${event.hidden ? '노출' : '숨김'}">${event.hidden ? '&#9711;' : '&#10005;'}</button>
        </div>
    `;

    eventEl.innerHTML = `
        ${adminHtml}
        <img class="overview-event-image" alt="">
        <span class="overview-event-title">${escapeHtml(title)}</span>
        <span class="overview-event-prob ${probClass}">${prob}%</span>
    `;

    const eventImg = eventEl.querySelector('.overview-event-image') as HTMLImageElement | null;
    if (eventImg) applySafeImage(eventImg, imageUrl);

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
