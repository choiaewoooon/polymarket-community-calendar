import { currentLang } from '../i18n.ts';
import { translations, getTitle, getLocale } from '../i18n.ts';
import { categoryColors } from '../constants.ts';
import { toKSTDateString, getKSTToday, getKSTTime, getTimeClass, addDays, escapeHtml, formatCurrency, applySafeImage, getMainProb, inferCategory } from '../utils.ts';
import { getFilteredEvents } from '../filters.ts';
import { showEventTooltip, hideEventTooltip, positionTooltip } from './tooltip.ts';
import { openEventLink } from './modal.ts';
import type { PolyEvent } from '../types.ts';

// ─── 모바일 단일 날짜 인덱스 ───
let mobileDayIndex = 0;
let prevMobileDayIndex = 0;
let slideDirection: 'left' | 'right' | null = null;

export function renderWeekView(searchQuery = ''): void {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile) {
        renderMobileDayView(searchQuery);
    } else {
        renderDesktopWeekView(searchQuery);
    }
}

// ─── 데스크톱: 기존 5열 뷰 ───

function renderDesktopWeekView(searchQuery: string): void {
    const todayKST = getKSTToday();
    const filtered = getFilteredEvents(searchQuery);
    const nowKST = new Date();

    const weekDates: string[] = [];
    for (let i = 0; i < 5; i++) {
        weekDates.push(addDays(todayKST, i));
    }

    const eventsByDate = buildEventsByDate(filtered, weekDates, todayKST, nowKST);

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

// ─── 모바일: 하루 단일 뷰 + 좌우 화살표 ───

function renderMobileDayView(searchQuery: string): void {
    const todayKST = getKSTToday();
    const filtered = getFilteredEvents(searchQuery);
    const nowKST = new Date();

    const weekDates: string[] = [];
    for (let i = 0; i < 5; i++) {
        weekDates.push(addDays(todayKST, i));
    }

    const eventsByDate = buildEventsByDate(filtered, weekDates, todayKST, nowKST);

    // 범위 제한
    if (mobileDayIndex < 0) mobileDayIndex = 0;
    if (mobileDayIndex >= weekDates.length) mobileDayIndex = weekDates.length - 1;

    const currentDateKey = weekDates[mobileDayIndex];
    const dayEvents = eventsByDate[currentDateKey] || [];
    const date = new Date(currentDateKey + 'T00:00:00');
    const isToday = currentDateKey === todayKST;

    const dayName = date.toLocaleDateString(getLocale(), { weekday: 'long', timeZone: 'Asia/Seoul' });
    const dayNumber = date.getDate();
    const monthName = date.toLocaleDateString(getLocale(), { month: 'long', timeZone: 'Asia/Seoul' });
    const dayDateText = currentLang === 'ko' ? `${monthName} ${dayNumber}일` : `${monthName} ${dayNumber}`;

    // 주 범위 텍스트
    const weekStart = new Date(todayKST + 'T00:00:00');
    const weekEnd = new Date(addDays(todayKST, 4) + 'T00:00:00');
    const weekRangeText = `${weekStart.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })} - ${weekEnd.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })}`;
    document.getElementById('weekRange')!.textContent = weekRangeText;

    const timeline = document.getElementById('weekTimeline')!;
    timeline.innerHTML = '';

    // 날짜 네비게이션 헤더
    const navEl = document.createElement('div');
    navEl.className = 'mobile-day-nav';
    navEl.innerHTML = `
        <button class="mobile-day-arrow mobile-day-prev" ${mobileDayIndex === 0 ? 'disabled' : ''}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
        </button>
        <div class="mobile-day-info">
            <div class="mobile-day-name">${dayName}</div>
            <div class="mobile-day-date">${dayDateText}${isToday ? ` <span class="mobile-day-today-badge">TODAY</span>` : ''}</div>
            <div class="mobile-day-count">${dayEvents.length}${translations[currentLang].events}</div>
        </div>
        <button class="mobile-day-arrow mobile-day-next" ${mobileDayIndex >= weekDates.length - 1 ? 'disabled' : ''}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        </button>
    `;

    // 날짜 도트 인디케이터
    const dotsEl = document.createElement('div');
    dotsEl.className = 'mobile-day-dots';
    weekDates.forEach((dk, i) => {
        const dot = document.createElement('button');
        dot.className = `mobile-day-dot${i === mobileDayIndex ? ' active' : ''}${dk === todayKST ? ' is-today' : ''}`;
        const evtCount = (eventsByDate[dk] || []).length;
        if (evtCount > 0) dot.classList.add('has-events');
        dot.addEventListener('click', () => {
            prevMobileDayIndex = mobileDayIndex;
            slideDirection = i > mobileDayIndex ? 'left' : i < mobileDayIndex ? 'right' : null;
            mobileDayIndex = i;
            renderWeekView(searchQuery);
        });
        dotsEl.appendChild(dot);
    });

    timeline.appendChild(navEl);
    timeline.appendChild(dotsEl);

    // 이벤트 목록
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'mobile-day-events';

    if (dayEvents.length === 0) {
        eventsContainer.innerHTML = `
            <div class="mobile-empty-state">
                <div class="mobile-empty-icon">&#9734;</div>
                <div class="mobile-empty-text">${translations[currentLang].noEvents}</div>
                <div class="mobile-empty-hint">이 날짜에 만료 예정인 이벤트가 없습니다</div>
            </div>`;
    } else {
        dayEvents.forEach(event => {
            renderWeekEventCard(eventsContainer, event);
        });
    }

    timeline.appendChild(eventsContainer);

    // 슬라이드 애니메이션 적용
    if (slideDirection) {
        eventsContainer.classList.add(`slide-in-${slideDirection}`);
        slideDirection = null;
    }

    // 화살표 이벤트
    navEl.querySelector('.mobile-day-prev')?.addEventListener('click', () => {
        if (mobileDayIndex > 0) {
            prevMobileDayIndex = mobileDayIndex;
            mobileDayIndex--;
            slideDirection = 'right';
            renderWeekView(searchQuery);
        }
    });

    navEl.querySelector('.mobile-day-next')?.addEventListener('click', () => {
        if (mobileDayIndex < weekDates.length - 1) {
            prevMobileDayIndex = mobileDayIndex;
            mobileDayIndex++;
            slideDirection = 'left';
            renderWeekView(searchQuery);
        }
    });
}

// ─── 공통: 날짜별 이벤트 그룹핑 ───

function buildEventsByDate(
    filtered: PolyEvent[],
    weekDates: string[],
    todayKST: string,
    nowKST: Date
): Record<string, PolyEvent[]> {
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

    return eventsByDate;
}

// ─── 이벤트 카드 렌더링 ───

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
            <div class="week-event-prob-bar">
                <div class="week-event-prob-fill ${probClass}" style="width:${prob}%"></div>
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
