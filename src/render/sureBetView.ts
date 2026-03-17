import { sureBetEvents, sureBetSort, sureBetMinProb, sureBetSelectedCategory, sureBetLastUpdate, sureBetIsRefreshing, setSureBetSort, setSureBetMinProb, setSureBetSelectedCategory } from '../state.ts';
import { categoryColors } from '../constants.ts';
import { escapeHtml, formatCurrency, applySafeImage, inferCategory } from '../utils.ts';
import { getTitle, currentLang } from '../i18n.ts';
import { openEventLink } from './modal.ts';
import { showEventTooltip, hideEventTooltip, positionTooltip } from './tooltip.ts';
import type { PolyEvent } from '../types.ts';

// ─── 수익률 계산 유틸 ───

interface SureBetCalc {
    price: number;
    direction: 'Yes' | 'No';
    returnPct: number;
    annualizedPct: number;
    daysLeft: number;
    hoursLeft: number;
    diffMs: number;
    safetyLevel: 'high' | 'medium' | 'low';
    spreadPct: number;
}

function calcSureBet(event: PolyEvent): SureBetCalc {
    const probs = (event.probs || []).map(p => parseFloat(String(p)));
    const yesProb = probs[0] || 0.5;
    const noProb = probs.length > 1 ? probs[1] : 1 - yesProb;

    let price: number;
    let direction: 'Yes' | 'No';
    if (yesProb >= noProb) {
        price = yesProb;
        direction = 'Yes';
    } else {
        price = noProb;
        direction = 'No';
    }

    const returnPct = price > 0 ? ((1 - price) / price) * 100 : 0;

    const now = new Date();
    const end = new Date(event.end_date);
    const diffMs = Math.max(end.getTime() - now.getTime(), 0);
    const daysLeft = diffMs / (1000 * 60 * 60 * 24);
    const hoursLeft = diffMs / (1000 * 60 * 60);

    const annualizedPct = daysLeft > 0 ? returnPct * (365 / daysLeft) : 0;

    // 안전 등급: 거래량 + 유동성 복합 판단
    const volume = event._totalVolume || event.volume;
    const liq = event.liquidity || 0;
    let safetyLevel: 'high' | 'medium' | 'low';
    if (volume >= 1000000 && liq >= 50000) {
        safetyLevel = 'high';
    } else if (volume >= 100000 && liq >= 5000) {
        safetyLevel = 'medium';
    } else {
        safetyLevel = 'low';
    }

    // 스프레드 %
    const spreadPct = event.spread ? event.spread * 100 : 0;

    return { price, direction, returnPct, annualizedPct, daysLeft, hoursLeft, diffMs, safetyLevel, spreadPct };
}

function getTimeRemainingText(diffMs: number): string {
    if (diffMs <= 0) return currentLang === 'ko' ? '곧 종료' : 'Ending soon';

    const totalSec = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    const isKo = currentLang === 'ko';

    if (days >= 7) {
        return isKo ? `${days}일 ${hours}시간` : `${days}d ${hours}h`;
    }
    if (days >= 1) {
        return isKo ? `${days}일 ${hours}시간 ${mins}분` : `${days}d ${hours}h ${mins}m`;
    }
    if (hours >= 1) {
        return isKo ? `${hours}시간 ${mins}분 ${secs}초` : `${hours}h ${mins}m ${secs}s`;
    }
    if (mins >= 1) {
        return isKo ? `${mins}분 ${secs}초` : `${mins}m ${secs}s`;
    }
    return isKo ? `${secs}초` : `${secs}s`;
}

function getUrgencyClass(daysLeft: number): string {
    if (daysLeft < 1) return 'urgent';
    if (daysLeft < 7) return 'soon';
    return 'later';
}

function getSafetyIcon(level: 'high' | 'medium' | 'low'): string {
    switch (level) {
        case 'high': return '<span class="sb-safety sb-safety-high" title="$1M+ Vol, $50K+ Liq">A</span>';
        case 'medium': return '<span class="sb-safety sb-safety-medium" title="$100K+ Vol, $5K+ Liq">B</span>';
        case 'low': return '<span class="sb-safety sb-safety-low" title="<$100K Vol">C</span>';
    }
}

// ─── 정렬 ───

function getSortedEvents(events: PolyEvent[]): PolyEvent[] {
    const withCalc = events.map(e => ({ event: e, calc: calcSureBet(e) }));

    switch (sureBetSort) {
        case 'return':
            withCalc.sort((a, b) => b.calc.returnPct - a.calc.returnPct);
            break;
        case 'annualized':
            withCalc.sort((a, b) => b.calc.annualizedPct - a.calc.annualizedPct);
            break;
        case 'endDate':
            withCalc.sort((a, b) => a.calc.daysLeft - b.calc.daysLeft);
            break;
        case 'volume':
            withCalc.sort((a, b) => (b.event._totalVolume || b.event.volume) - (a.event._totalVolume || a.event.volume));
            break;
    }

    return withCalc.map(x => x.event);
}

// ─── 카테고리 필터 ───

function getSureBetCategories(events: PolyEvent[]): Record<string, number> {
    const now = new Date();
    const cats: Record<string, number> = {};
    events.forEach(e => {
        if (new Date(e.end_date) <= now || e.closed) return;
        const maxProb = Math.max(...(e.probs || []).map(p => parseFloat(String(p))));
        if (maxProb < sureBetMinProb / 100) return;
        const cat = inferCategory(e);
        cats[cat] = (cats[cat] || 0) + 1;
    });
    return cats;
}

function renderSureBetCategoryFilters(allFiltered: PolyEvent[]): void {
    const container = document.getElementById('sureBetCategoryFilters');
    if (!container) return;
    container.innerHTML = '';

    const categories = getSureBetCategories(sureBetEvents);

    // 전체 버튼 (스포츠 제외 카운트)
    const nonSportsCount = allFiltered.filter(e => inferCategory(e) !== 'Sports').length;
    const allChip = document.createElement('button');
    allChip.className = `korea-cat-chip${sureBetSelectedCategory === null ? ' active' : ''}`;
    allChip.textContent = currentLang === 'ko' ? `전체 (${nonSportsCount})` : `All (${nonSportsCount})`;
    allChip.addEventListener('click', () => {
        setSureBetSelectedCategory(null);
        renderSureBetView();
    });
    container.appendChild(allChip);

    Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .forEach(([cat, count]) => {
            const chip = document.createElement('button');
            chip.className = `korea-cat-chip${sureBetSelectedCategory === cat ? ' active' : ''}`;
            const color = categoryColors[cat] || categoryColors['default'];
            chip.innerHTML = `<span class="korea-cat-dot" style="background:${color}"></span>${cat} (${count})`;
            chip.addEventListener('click', () => {
                setSureBetSelectedCategory(sureBetSelectedCategory === cat ? null : cat);
                renderSureBetView();
            });
            container.appendChild(chip);
        });
}

// ─── 라이브 표시기 ───

function updateLiveIndicator(): void {
    const el = document.getElementById('sureBetLiveTime');
    if (!el) return;

    if (sureBetLastUpdate === 0) {
        el.textContent = '';
        return;
    }

    const ago = Math.round((Date.now() - sureBetLastUpdate) / 1000);
    if (ago < 5) {
        el.textContent = currentLang === 'ko' ? '방금 갱신' : 'Just now';
    } else {
        el.textContent = currentLang === 'ko' ? `${ago}초 전` : `${ago}s ago`;
    }

    // 갱신 중 표시
    const dot = document.getElementById('sureBetLiveDot');
    if (dot) {
        dot.classList.toggle('refreshing', sureBetIsRefreshing);
    }
}

// ─── 요약 통계 ───

function renderSureBetStats(events: PolyEvent[]): string {
    if (events.length === 0) return '';

    const calcs = events.map(e => calcSureBet(e));
    const avgReturn = calcs.reduce((sum, c) => sum + c.returnPct, 0) / calcs.length;
    const endingSoon = calcs.filter(c => c.daysLeft < 3).length;
    const totalVolume = events.reduce((sum, e) => sum + (e._totalVolume || e.volume), 0);
    const highSafety = calcs.filter(c => c.safetyLevel === 'high').length;

    const isKo = currentLang === 'ko';

    return `
        <div class="sb-stats">
            <div class="sb-stat-card">
                <div class="sb-stat-value">${events.length}</div>
                <div class="sb-stat-label">${isKo ? '기회 발견' : 'Opportunities'}</div>
            </div>
            <div class="sb-stat-card">
                <div class="sb-stat-value">${avgReturn.toFixed(1)}%</div>
                <div class="sb-stat-label">${isKo ? '평균 수익률' : 'Avg Return'}</div>
            </div>
            <div class="sb-stat-card sb-stat-urgent">
                <div class="sb-stat-value">${endingSoon}</div>
                <div class="sb-stat-label">${isKo ? '3일 내 마감' : 'Ending in 3d'}</div>
            </div>
            <div class="sb-stat-card">
                <div class="sb-stat-value">$${formatCurrency(totalVolume)}</div>
                <div class="sb-stat-label">${isKo ? '총 거래량' : 'Total Volume'}</div>
            </div>
            <div class="sb-stat-card">
                <div class="sb-stat-value">${highSafety}</div>
                <div class="sb-stat-label">${isKo ? '안전 등급 A' : 'Safe Grade A'}</div>
            </div>
        </div>
    `;
}

// ─── 메인 렌더 ───

export function renderSureBetView(): void {
    const grid = document.getElementById('sureBetCardsGrid');
    const countEl = document.getElementById('sureBetCount');
    const statsEl = document.getElementById('sureBetStats');
    if (!grid) return;

    const now = new Date();

    // 1단계: 종료 + 확률 필터
    let filtered = sureBetEvents.filter(e => {
        if (new Date(e.end_date) <= now || e.closed) return false;
        const maxProb = Math.max(...(e.probs || []).map(p => parseFloat(String(p))));
        return maxProb >= sureBetMinProb / 100;
    });

    // 카테고리 필터 렌더 (필터 적용 전 전체 데이터 기반)
    renderSureBetCategoryFilters(filtered);

    // 2단계: 카테고리 필터 (기본: 스포츠 제외)
    if (sureBetSelectedCategory) {
        filtered = filtered.filter(e => inferCategory(e) === sureBetSelectedCategory);
    } else {
        filtered = filtered.filter(e => inferCategory(e) !== 'Sports');
    }

    const sorted = getSortedEvents(filtered);

    if (countEl) {
        countEl.textContent = currentLang === 'ko'
            ? `${sorted.length}개 기회`
            : `${sorted.length} opportunities`;
    }

    if (statsEl) {
        const newStats = renderSureBetStats(sorted);
        if (statsEl.innerHTML !== newStats) {
            statsEl.innerHTML = newStats;
        }
    }

    // 라이브 표시기 업데이트
    updateLiveIndicator();

    // 정렬 버튼 상태
    document.querySelectorAll('.sb-sort-btn').forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.sort === sureBetSort);
    });

    // 확률 필터 버튼 상태
    document.querySelectorAll('.sb-prob-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt((btn as HTMLElement).dataset.prob || '90') === sureBetMinProb);
    });

    if (sorted.length === 0) {
        grid.innerHTML = `<div class="korea-empty">${currentLang === 'ko' ? '조건에 맞는 마켓이 없습니다' : 'No markets match this criteria'}</div>`;
        stopCountdownTimer();
        return;
    }

    // 기존 카드가 있고 이벤트 ID 목록이 같으면 DOM 재활용 (깜빡임 방지)
    const existingIds = Array.from(grid.querySelectorAll('.sb-card[data-event-id]'))
        .map(el => (el as HTMLElement).dataset.eventId);
    const newIds = sorted.map(e => e.id);
    const isSameList = existingIds.length === newIds.length &&
        existingIds.every((id, i) => id === newIds[i]);

    if (isSameList && existingIds.length > 0) {
        // 같은 목록이면 카운트다운이 자체 갱신하므로 스킵
        startCountdownTimer();
        return;
    }

    // 다른 목록이면 부드럽게 교체
    const fragment = document.createDocumentFragment();
    sorted.forEach(event => {
        renderSureBetCard(fragment as unknown as HTMLElement, event);
    });

    grid.style.opacity = '0.4';
    requestAnimationFrame(() => {
        grid.innerHTML = '';
        grid.appendChild(fragment);
        // 다음 프레임에서 fade-in
        requestAnimationFrame(() => {
            grid.style.transition = 'opacity 0.25s ease-out';
            grid.style.opacity = '1';
        });
        startCountdownTimer();
    });
}

// ─── 카드 렌더 ───

function renderSureBetCard(container: HTMLElement, event: PolyEvent): void {
    const calc = calcSureBet(event);
    const imageUrl = event.image_url || '';
    const volume = event._totalVolume || event.volume;
    const category = inferCategory(event);
    const categoryColor = categoryColors[category] || categoryColors['default'];
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const urgencyClass = getUrgencyClass(calc.daysLeft);
    const timeText = getTimeRemainingText(calc.diffMs);

    const card = document.createElement('div');
    card.className = `sb-card sb-urgency-${urgencyClass}`;
    card.dataset.eventId = event.id;
    card.onclick = () => openEventLink(slugSafe, '', eventSlugSafe);

    card.addEventListener('mouseenter', (e) => showEventTooltip(e, event));
    card.addEventListener('mousemove', (e) => positionTooltip(e));
    card.addEventListener('mouseleave', hideEventTooltip);

    const probDisplay = Math.round(calc.price * 100);
    const liq = event.liquidity || 0;
    const spreadDisplay = calc.spreadPct > 0 ? calc.spreadPct.toFixed(1) : '-';
    const spreadClass = calc.spreadPct > 5 ? 'sb-spread-wide' : calc.spreadPct > 2 ? 'sb-spread-mid' : 'sb-spread-tight';

    // Bid/Ask 표시
    const bidAskText = event.bestBid && event.bestAsk
        ? `${(event.bestBid * 100).toFixed(0)}¢/${(event.bestAsk * 100).toFixed(0)}¢`
        : '';

    card.innerHTML = `
        <div class="sb-card-image-wrap">
            <img class="sb-card-image" alt="">
            <div class="sb-card-badge" style="--cat-color: ${categoryColor}">
                <span class="sb-badge-dot" style="background:${categoryColor}"></span>
                ${escapeHtml(category)}
            </div>
        </div>
        <div class="sb-card-body">
            <h3 class="sb-card-title">${escapeHtml(getTitle(event))}</h3>
            <div class="sb-card-meta">
                <span class="sb-meta-item">
                    ${getSafetyIcon(calc.safetyLevel)}
                    $${formatCurrency(volume)} Vol
                </span>
                <span class="sb-meta-item sb-meta-liq">
                    $${formatCurrency(liq)} Liq
                </span>
                <span class="sb-meta-item ${spreadClass}" title="Bid/Ask: ${bidAskText}">
                    Spread ${spreadDisplay}%
                </span>
                <span class="sb-meta-item sb-meta-time sb-time-${urgencyClass}" data-end-date="${event.end_date}">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span class="sb-countdown-text">${timeText}</span>
                </span>
                <span class="sb-meta-item sb-meta-direction">
                    ${calc.direction} ${probDisplay}%
                </span>
            </div>
        </div>
        <div class="sb-card-returns" data-end-date="${event.end_date}" data-return-pct="${calc.returnPct.toFixed(4)}">
            <div class="sb-return-main">
                <span class="sb-return-value">+${calc.returnPct.toFixed(1)}%</span>
                <span class="sb-return-label">${currentLang === 'ko' ? '수익률' : 'Return'}</span>
            </div>
            <div class="sb-return-annual">
                <span class="sb-annual-value">${calc.annualizedPct > 9999 ? '9999+' : Math.round(calc.annualizedPct)}%</span>
                <span class="sb-annual-label">${currentLang === 'ko' ? '연환산' : 'APY'}</span>
            </div>
        </div>
    `;

    const eventImg = card.querySelector('.sb-card-image') as HTMLImageElement | null;
    if (eventImg) applySafeImage(eventImg, imageUrl);

    container.appendChild(card);
}

// ─── 실시간 카운트다운 타이머 ───

let countdownInterval: ReturnType<typeof setInterval> | null = null;

function startCountdownTimer(): void {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const timeEls = document.querySelectorAll('.sb-meta-time[data-end-date]');
        if (timeEls.length === 0) return;

        const now = Date.now();

        // 카운트다운 텍스트 + 긴급도 업데이트
        timeEls.forEach(el => {
            const endDate = (el as HTMLElement).dataset.endDate;
            if (!endDate) return;
            const diffMs = Math.max(new Date(endDate).getTime() - now, 0);
            const textEl = el.querySelector('.sb-countdown-text');
            if (textEl) {
                textEl.textContent = getTimeRemainingText(diffMs);
            }
            const daysLeft = diffMs / (1000 * 60 * 60 * 24);
            const parentCard = el.closest('.sb-card');
            if (parentCard) {
                const newUrgency = getUrgencyClass(daysLeft);
                parentCard.classList.remove('sb-urgency-urgent', 'sb-urgency-soon', 'sb-urgency-later');
                parentCard.classList.add(`sb-urgency-${newUrgency}`);
            }
            el.classList.remove('sb-time-urgent', 'sb-time-soon', 'sb-time-later');
            el.classList.add(`sb-time-${getUrgencyClass(daysLeft)}`);
        });

        // 연환산 수익률(APY) 실시간 재계산
        const returnEls = document.querySelectorAll('.sb-card-returns[data-end-date]');
        returnEls.forEach(el => {
            const endDate = (el as HTMLElement).dataset.endDate;
            const returnPct = parseFloat((el as HTMLElement).dataset.returnPct || '0');
            if (!endDate) return;
            const diffMs = Math.max(new Date(endDate).getTime() - now, 0);
            const daysLeft = diffMs / (1000 * 60 * 60 * 24);
            const annualized = daysLeft > 0 ? returnPct * (365 / daysLeft) : 0;
            const annualEl = el.querySelector('.sb-annual-value');
            if (annualEl) {
                annualEl.textContent = `${annualized > 9999 ? '9999+' : Math.round(annualized)}%`;
            }
        });
    }, 1000);
}

export function stopCountdownTimer(): void {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

// ─── 이벤트 리스너 초기화 ───

export function initSureBetListeners(): void {
    document.querySelectorAll('.sb-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sort = (btn as HTMLElement).dataset.sort as 'return' | 'annualized' | 'endDate' | 'volume';
            setSureBetSort(sort);
            renderSureBetView();
        });
    });

    document.querySelectorAll('.sb-prob-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prob = parseInt((btn as HTMLElement).dataset.prob || '90');
            setSureBetMinProb(prob);
            renderSureBetView();
        });
    });
}
