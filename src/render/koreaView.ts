import { koreaEvents, koreaSort, koreaSelectedCategory, setKoreaSort, setKoreaSelectedCategory } from '../state.ts';
import { categoryColors } from '../constants.ts';
import { escapeHtml, formatCurrency, applySafeImage, getMainProb, inferCategory } from '../utils.ts';
import { getTitle, currentLang } from '../i18n.ts';
import { openEventLink } from './modal.ts';
import { showEventTooltip, hideEventTooltip, positionTooltip } from './tooltip.ts';
import type { PolyEvent } from '../types.ts';

function getTimeRemaining(endDate: string): string {
    const now = new Date();
    const end = new Date(endDate);
    const diffMs = end.getTime() - now.getTime();

    if (diffMs <= 0) return '종료됨';

    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (diffDays > 30) {
        const months = Math.floor(diffDays / 30);
        return currentLang === 'ko' ? `약 ${months}개월 후` : `in about ${months} months`;
    }
    if (diffDays > 0) {
        return currentLang === 'ko' ? `${diffDays}일 후 종료` : `Ends in ${diffDays} days`;
    }
    return currentLang === 'ko' ? `${diffHours}시간 후 종료` : `Ends in ${diffHours} hours`;
}

function getEndDateFormatted(endDate: string): string {
    const date = new Date(endDate);
    return date.toLocaleDateString(currentLang === 'ko' ? 'ko-KR' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'Asia/Seoul'
    });
}

function getSortedEvents(events: PolyEvent[]): PolyEvent[] {
    const sorted = [...events];
    switch (koreaSort) {
        case 'endDate':
            sorted.sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());
            break;
        case 'volume':
            sorted.sort((a, b) => (b._totalVolume || b.volume) - (a._totalVolume || a.volume));
            break;
        case 'probability':
            sorted.sort((a, b) => getMainProb(b) - getMainProb(a));
            break;
    }
    return sorted;
}

function getKoreaCategories(events: PolyEvent[]): Record<string, number> {
    const cats: Record<string, number> = {};
    events.forEach(e => {
        const cat = inferCategory(e);
        cats[cat] = (cats[cat] || 0) + 1;
    });
    return cats;
}

export function renderKoreaCategoryFilters(): void {
    const container = document.getElementById('koreaCategoryFilters');
    if (!container) return;
    container.innerHTML = '';

    const categories = getKoreaCategories(koreaEvents);

    // 전체 버튼 (스포츠 제외 카운트)
    const nonSportsCount = koreaEvents.filter(e => inferCategory(e) !== 'Sports' && new Date(e.end_date) > new Date() && !e.closed).length;
    const allChip = document.createElement('button');
    allChip.className = `korea-cat-chip${koreaSelectedCategory === null ? ' active' : ''}`;
    allChip.textContent = currentLang === 'ko' ? `전체 (${nonSportsCount})` : `All (${nonSportsCount})`;
    allChip.addEventListener('click', () => {
        setKoreaSelectedCategory(null);
        renderKoreaView();
    });
    container.appendChild(allChip);

    Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .forEach(([cat, count]) => {
            const chip = document.createElement('button');
            chip.className = `korea-cat-chip${koreaSelectedCategory === cat ? ' active' : ''}`;
            const color = categoryColors[cat] || categoryColors['default'];
            chip.innerHTML = `<span class="korea-cat-dot" style="background:${color}"></span>${cat} (${count})`;
            chip.addEventListener('click', () => {
                setKoreaSelectedCategory(koreaSelectedCategory === cat ? null : cat);
                renderKoreaView();
            });
            container.appendChild(chip);
        });
}

export function renderKoreaView(): void {
    const grid = document.getElementById('koreaCardsGrid');
    const countEl = document.getElementById('koreaViewCount');
    if (!grid) return;

    // 카테고리 필터링 (기본: 스포츠 제외)
    let filtered: PolyEvent[];
    if (koreaSelectedCategory) {
        filtered = koreaEvents.filter(e => inferCategory(e) === koreaSelectedCategory);
    } else {
        // 스포츠 기본 제외 (사용자가 명시적으로 Sports 선택 시에만 표시)
        filtered = koreaEvents.filter(e => inferCategory(e) !== 'Sports');
    }

    // 종료되지 않은 것만
    const now = new Date();
    filtered = filtered.filter(e => new Date(e.end_date) > now && !e.closed);

    const sorted = getSortedEvents(filtered);

    if (countEl) {
        countEl.textContent = currentLang === 'ko'
            ? `${sorted.length}개 시장`
            : `${sorted.length} markets`;
    }

    // 카테고리 필터 렌더
    renderKoreaCategoryFilters();

    // 정렬 버튼 상태 동기화
    document.querySelectorAll('.korea-sort-btn').forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.sort === koreaSort);
    });

    grid.innerHTML = '';

    if (sorted.length === 0) {
        grid.innerHTML = `<div class="korea-empty">${currentLang === 'ko' ? '한국 관련 시장이 없습니다' : 'No Korea-related markets found'}</div>`;
        return;
    }

    sorted.forEach(event => {
        renderKoreaCard(grid, event);
    });
}

function renderKoreaCard(container: HTMLElement, event: PolyEvent): void {
    const imageUrl = event.image_url || '';
    const prob = getMainProb(event);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : 'high';
    const volume = event._totalVolume || event.volume;
    const category = inferCategory(event);
    const categoryColor = categoryColors[category] || categoryColors['default'];
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const timeRemaining = getTimeRemaining(event.end_date);
    const endDateStr = getEndDateFormatted(event.end_date);
    const groupSize = event._groupSize || 1;
    const liquidity = event.liquidity || Math.round(volume * 0.1);

    const card = document.createElement('div');
    card.className = 'korea-card';
    card.onclick = () => openEventLink(slugSafe, '', eventSlugSafe);

    card.addEventListener('mouseenter', (e) => showEventTooltip(e, event));
    card.addEventListener('mousemove', (e) => positionTooltip(e));
    card.addEventListener('mouseleave', hideEventTooltip);

    card.innerHTML = `
        <div class="korea-card-image-wrap">
            <img class="korea-card-image" alt="">
            <div class="korea-card-category" style="--cat-color: ${categoryColor}">
                <span class="korea-card-cat-dot" style="background:${categoryColor}"></span>
                ${escapeHtml(category)}${event.tags && event.tags.length > 0 ? ` · ${escapeHtml(event.tags[0])}` : ''}
            </div>
        </div>
        <div class="korea-card-body">
            <h3 class="korea-card-title">${escapeHtml(getTitle(event))}</h3>
            <div class="korea-card-meta">
                <div class="korea-card-stats">
                    <span class="korea-stat">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
                            <polyline points="16 7 22 7 22 13"></polyline>
                        </svg>
                        $${formatCurrency(volume)} Vol.
                    </span>
                    <span class="korea-stat">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
                        </svg>
                        $${formatCurrency(liquidity)} Liq.
                    </span>
                    <span class="korea-stat korea-stat-time">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${timeRemaining}
                    </span>
                </div>
            </div>
            <div class="korea-card-footer">
                <span class="korea-card-date">${endDateStr}</span>
                ${groupSize > 1 ? `<span class="korea-card-group">${groupSize}${currentLang === 'ko' ? '개 시장' : ' markets'}</span>` : ''}
            </div>
        </div>
        <div class="korea-card-prob ${probClass}">
            <span class="korea-prob-value">${prob}%</span>
            ${prob >= 50
                ? `<span class="korea-prob-label">${event.probs && event.probs.length === 2 ? (prob > 50 ? 'Yes' : '') : ''}</span>`
                : `<span class="korea-prob-label">${event.probs && event.probs.length === 2 ? 'No' : ''}</span>`
            }
        </div>
    `;

    const eventImg = card.querySelector('.korea-card-image') as HTMLImageElement | null;
    if (eventImg) applySafeImage(eventImg, imageUrl);

    container.appendChild(card);
}

export function initKoreaSortListeners(): void {
    document.querySelectorAll('.korea-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sort = (btn as HTMLElement).dataset.sort as 'endDate' | 'volume' | 'probability';
            setKoreaSort(sort);
            renderKoreaView();
        });
    });
}
