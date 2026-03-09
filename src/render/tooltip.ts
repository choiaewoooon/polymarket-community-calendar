import { tooltipElement, tooltipTimeout, setTooltipElement, setTooltipTimeout } from '../state.ts';
import { categoryColors } from '../constants.ts';
import { escapeHtml, formatCurrency, getMainProb, inferCategory } from '../utils.ts';
import { translations, currentLang, getTitle } from '../i18n.ts';
import type { PolyEvent } from '../types.ts';

export function initTooltip(): void {
    const el = document.createElement('div');
    el.className = 'event-tooltip';
    document.body.appendChild(el);
    setTooltipElement(el);
}

export function showEventTooltip(event: MouseEvent, eventData: PolyEvent): void {
    if (!tooltipElement || !eventData) return;

    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
    }

    const prob = getMainProb(eventData);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const volume = formatCurrency(eventData._totalVolume || eventData.volume || 0);
    const volume24hr = formatCurrency(eventData.volume_24hr || 0);
    const category = inferCategory(eventData);
    const categoryColor = categoryColors[category] || categoryColors['default'];
    const liquidity = eventData.liquidity ? formatCurrency(eventData.liquidity) : 'N/A';

    const t = translations[currentLang];
    tooltipElement.innerHTML = `
        <div class="tooltip-title">${escapeHtml(getTitle(eventData))}</div>
        <div class="tooltip-stats">
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.probability || 'Probability'}:</span>
                <span class="tooltip-stat-value prob ${probClass}">${prob}%</span>
            </div>
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.volume || 'Volume'}:</span>
                <span class="tooltip-stat-value">${volume}</span>
            </div>
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.volume24hr || '24hr Volume'}:</span>
                <span class="tooltip-stat-value">${volume24hr}</span>
            </div>
            ${liquidity !== 'N/A' ? `
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.liquidity || 'Liquidity'}:</span>
                <span class="tooltip-stat-value">${liquidity}</span>
            </div>
            ` : ''}
        </div>
        <div class="tooltip-category">
            <span class="tooltip-category-dot" style="background-color: ${categoryColor};"></span>
            ${escapeHtml(category)}
        </div>
    `;

    positionTooltip(event);

    setTooltipTimeout(setTimeout(() => {
        tooltipElement!.classList.add('visible');
    }, 300));
}

export function hideEventTooltip(): void {
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
    }
    if (tooltipElement) {
        tooltipElement.classList.remove('visible');
    }
}

export function positionTooltip(event: MouseEvent): void {
    if (!tooltipElement) return;

    const padding = 10;
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = event.clientX + padding;
    let y = event.clientY + padding;

    if (x + tooltipRect.width > viewportWidth - padding) {
        x = event.clientX - tooltipRect.width - padding;
    }
    if (y + tooltipRect.height > viewportHeight - padding) {
        y = event.clientY - tooltipRect.height - padding;
    }

    x = Math.max(padding, x);
    y = Math.max(padding, y);

    tooltipElement.style.left = x + 'px';
    tooltipElement.style.top = y + 'px';
}
