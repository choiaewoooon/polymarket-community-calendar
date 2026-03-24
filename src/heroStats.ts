import { allEvents, allCategories } from './state.ts';
import { getKSTToday } from './utils.ts';

// ─── 카운트업 애니메이션 ───

function animateCountUp(
    el: HTMLElement,
    target: number,
    duration: number = 800,
    formatter: (n: number) => string = (n) => n.toLocaleString()
): void {
    const start = performance.now();
    el.classList.add('counting');

    function tick(now: number) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // easeOutExpo
        const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const current = Math.round(target * eased);
        el.textContent = formatter(current);

        if (progress < 1) {
            requestAnimationFrame(tick);
        } else {
            el.textContent = formatter(target);
            el.classList.remove('counting');
        }
    }

    requestAnimationFrame(tick);
}

function formatVolume(vol: number): string {
    if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol.toLocaleString()}`;
}

// ─── 수치 업데이트 ───

let lastValues = { active: 0, ending: 0, volume: 0, categories: 0 };

export function updateHeroStats(): void {
    const todayStr = getKSTToday();

    const activeMarkets = allEvents.filter(e => !e.closed).length;
    const endingToday = allEvents.filter(e => {
        const endDate = new Date(e.end_date);
        const endStr = endDate.toLocaleString('en-CA', { timeZone: 'Asia/Seoul' }).split(',')[0];
        return endStr === todayStr && !e.closed;
    }).length;
    const totalVolume = allEvents.reduce((sum, e) => sum + (Number(e.volume) || 0), 0);
    const categoryCount = Object.keys(allCategories).length;

    const elActive = document.getElementById('statActiveMarkets');
    const elEnding = document.getElementById('statEndingToday');
    const elVolume = document.getElementById('statTotalVolume');
    const elCats = document.getElementById('statCategories');

    if (elActive && activeMarkets !== lastValues.active) {
        animateCountUp(elActive, activeMarkets, 900);
    }
    if (elEnding && endingToday !== lastValues.ending) {
        animateCountUp(elEnding, endingToday, 700);
    }
    if (elVolume && totalVolume !== lastValues.volume) {
        animateCountUp(elVolume, totalVolume, 1100, formatVolume);
    }
    if (elCats && categoryCount !== lastValues.categories) {
        animateCountUp(elCats, categoryCount, 600);
    }

    lastValues = { active: activeMarkets, ending: endingToday, volume: totalVolume, categories: categoryCount };
}

// ─── 랜딩 페이지 수치 업데이트 ───

let landingAnimated = false;

export function updateLandingStats(): void {
    const todayStr = getKSTToday();

    const activeMarkets = allEvents.filter(e => !e.closed).length;
    const endingToday = allEvents.filter(e => {
        const endDate = new Date(e.end_date);
        const endStr = endDate.toLocaleString('en-CA', { timeZone: 'Asia/Seoul' }).split(',')[0];
        return endStr === todayStr && !e.closed;
    }).length;
    const totalVolume = allEvents.reduce((sum, e) => sum + (Number(e.volume) || 0), 0);

    const elMarkets = document.getElementById('landingStatMarkets');
    const elToday = document.getElementById('landingStatToday');
    const elVolume = document.getElementById('landingStatVolume');

    if (!landingAnimated && activeMarkets > 0) {
        landingAnimated = true;
        if (elMarkets) animateCountUp(elMarkets, activeMarkets, 1200);
        if (elToday) animateCountUp(elToday, endingToday, 900);
        if (elVolume) animateCountUp(elVolume, totalVolume, 1400, formatVolume);
    } else {
        if (elMarkets) elMarkets.textContent = activeMarkets.toLocaleString();
        if (elToday) elToday.textContent = endingToday.toLocaleString();
        if (elVolume) elVolume.textContent = formatVolume(totalVolume);
    }
}
