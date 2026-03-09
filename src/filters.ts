import { filters, tempFilters, allTags, allCategories, allEvents, setFilters, setTempFilters } from './state.ts';
import { categoryColors } from './constants.ts';
import { formatCurrency, inferCategory } from './utils.ts';
import { translations, currentLang } from './i18n.ts';
import { renderCalendar } from './render/index.ts';
import type { PolyEvent, Filters } from './types.ts';

// ─── Quick Category Filters ───

export function initQuickFilters(): void {
    const quickFiltersContainer = document.getElementById('quickFilters');
    if (!quickFiltersContainer) return;

    quickFiltersContainer.innerHTML = '';

    const mainCategories = Object.keys(categoryColors).filter(cat =>
        cat !== 'default' && cat !== 'Uncategorized'
    );

    mainCategories.forEach(category => {
        const color = categoryColors[category];
        const chip = document.createElement('button');
        chip.className = 'category-chip';
        chip.dataset.category = category;

        if (filters.excludedCategories.includes(category)) {
            chip.classList.add('excluded');
        }

        chip.innerHTML = `
            <span class="category-chip-color" style="background-color: ${color};"></span>
            <span>${category}</span>
        `;

        chip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCategoryFilter(category);
        });

        quickFiltersContainer.appendChild(chip);
    });
}

export function toggleCategoryFilter(category: string): void {
    const index = filters.excludedCategories.indexOf(category);
    if (index > -1) {
        filters.excludedCategories.splice(index, 1);
    } else {
        filters.excludedCategories.push(category);
    }

    updateQuickFilterChips();
    updateActiveFiltersDisplay();
    renderCalendar();
}

export function updateQuickFilterChips(): void {
    const chips = document.querySelectorAll('.category-chip');
    chips.forEach(chip => {
        const category = (chip as HTMLElement).dataset.category;
        if (category && filters.excludedCategories.includes(category)) {
            chip.classList.add('excluded');
        } else {
            chip.classList.remove('excluded');
        }
    });
}

// ─── Filter Modal ───

export function openFilterModal(): void {
    setTempFilters(JSON.parse(JSON.stringify(filters)));
    renderFilterTags();
    renderFilterCategories();
    syncFilterUI();
    document.getElementById('filterModalOverlay')!.classList.add('active');
}

export function closeFilterModal(): void {
    document.getElementById('filterModalOverlay')!.classList.remove('active');
}

export function renderFilterTags(searchQuery = ''): void {
    const container = document.getElementById('filterTags')!;
    container.innerHTML = '';

    const query = searchQuery.toLowerCase();
    const filteredTags = Object.entries(allTags)
        .filter(([tag]) => tag.toLowerCase().includes(query));

    filteredTags.forEach(([tag, count]) => {
        const chip = document.createElement('button');
        chip.className = `tag-chip${tempFilters.tags.includes(tag) ? ' active' : ''}`;
        chip.innerHTML = `${tag} <span class="tag-count">${count}</span>`;
        chip.addEventListener('click', () => {
            if (tempFilters.tags.includes(tag)) {
                tempFilters.tags = tempFilters.tags.filter(t => t !== tag);
                chip.classList.remove('active');
            } else {
                tempFilters.tags.push(tag);
                chip.classList.add('active');
            }
        });
        container.appendChild(chip);
    });
}

export function renderFilterCategories(): void {
    const container = document.getElementById('filterCategories')!;
    container.innerHTML = '';

    Object.entries(allCategories).forEach(([category, count]) => {
        const chip = document.createElement('button');
        chip.className = `tag-chip${tempFilters.excludedCategories.includes(category) ? ' excluded' : ''}`;
        chip.innerHTML = `${category} <span class="tag-count">${count}</span>`;
        chip.addEventListener('click', () => {
            if (tempFilters.excludedCategories.includes(category)) {
                tempFilters.excludedCategories = tempFilters.excludedCategories.filter(c => c !== category);
                chip.classList.remove('excluded');
            } else {
                tempFilters.excludedCategories.push(category);
                chip.classList.add('excluded');
            }
        });
        container.appendChild(chip);
    });
}

export function syncFilterUI(): void {
    document.querySelectorAll('#timeRemainingOptions .filter-option').forEach(btn => {
        const el = btn as HTMLElement;
        const value: string | number = el.dataset.value === 'all' ? 'all' : parseInt(el.dataset.value!);
        btn.classList.toggle('active', tempFilters.timeRemaining === value);
    });

    document.querySelectorAll('#minVolumeOptions .filter-option').forEach(btn => {
        const value = parseInt((btn as HTMLElement).dataset.value!);
        btn.classList.toggle('active', tempFilters.minVolume === value);
    });

    document.querySelectorAll('#minLiquidityOptions .filter-option').forEach(btn => {
        const value = parseInt((btn as HTMLElement).dataset.value!);
        btn.classList.toggle('active', tempFilters.minLiquidity === value);
    });
}

export function setupFilterOptions(containerId: string, filterKey: keyof Filters): void {
    const container = document.getElementById(containerId)!;
    container.querySelectorAll('.filter-option').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.filter-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const val = (btn as HTMLElement).dataset.value;
            (tempFilters as Record<string, unknown>)[filterKey] = val === 'all' ? 'all' : parseInt(val!);
        });
    });
}

export function applyFilters(): void {
    setFilters(JSON.parse(JSON.stringify(tempFilters)));
    closeFilterModal();
    updateQuickFilterChips();
    updateActiveFiltersDisplay();
    renderCalendar();
}

export function resetFilters(): void {
    setTempFilters({
        tags: [],
        excludedCategories: ['Sports'],
        timeRemaining: 'all',
        minVolume: 10000,
        minLiquidity: 0
    });
    renderFilterTags();
    renderFilterCategories();
    syncFilterUI();
}

export function clearAllFilters(): void {
    setFilters({
        tags: [],
        excludedCategories: ['Sports'],
        timeRemaining: 'all',
        minVolume: 10000,
        minLiquidity: 0
    });
    updateQuickFilterChips();
    updateActiveFiltersDisplay();
    renderCalendar();
}

export function updateActiveFiltersDisplay(): void {
    const container = document.getElementById('activeFilters')!;
    const clearBtn = document.getElementById('clearFilters') as HTMLElement;
    container.innerHTML = '';

    let hasFilters = false;

    filters.tags.forEach(tag => {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `${tag} <span class="remove-tag" data-type="tag" data-value="${tag}">×</span>`;
        container.appendChild(tagEl);
    });

    filters.excludedCategories.forEach(category => {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag excluded';
        tagEl.innerHTML = `🚫 ${category} <span class="remove-tag" data-type="excludedCategory" data-value="${category}">×</span>`;
        container.appendChild(tagEl);
    });

    if (filters.timeRemaining !== 'all') {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `< ${filters.timeRemaining} days <span class="remove-tag" data-type="timeRemaining">×</span>`;
        container.appendChild(tagEl);
    }

    if (filters.minVolume > 0) {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `Vol > $${formatCurrency(filters.minVolume)} <span class="remove-tag" data-type="minVolume">×</span>`;
        container.appendChild(tagEl);
    }

    if (filters.minLiquidity > 0) {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `Liq > $${formatCurrency(filters.minLiquidity)} <span class="remove-tag" data-type="minLiquidity">×</span>`;
        container.appendChild(tagEl);
    }

    if (!hasFilters) {
        container.innerHTML = '<span class="filter-placeholder">Click to add filters</span>';
    }

    clearBtn.style.display = hasFilters ? 'block' : 'none';

    container.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const el = btn as HTMLElement;
            const type = el.dataset.type;
            const value = el.dataset.value;

            if (type === 'tag') {
                filters.tags = filters.tags.filter(t => t !== value);
            } else if (type === 'excludedCategory') {
                filters.excludedCategories = filters.excludedCategories.filter(c => c !== value);
            } else if (type === 'timeRemaining') {
                filters.timeRemaining = 'all';
            } else if (type === 'minVolume') {
                filters.minVolume = 0;
            } else if (type === 'minLiquidity') {
                filters.minLiquidity = 0;
            }

            updateActiveFiltersDisplay();
            renderCalendar();
        });
    });
}

// ─── 필터링 로직 ───

export function getFilteredEvents(searchQuery = ''): PolyEvent[] {
    let filtered = [...allEvents];
    const now = new Date();

    if (filters.tags.length > 0) {
        filtered = filtered.filter(e =>
            e.tags && filters.tags.some(tag => e.tags!.includes(tag))
        );
    }

    if (filters.excludedCategories.length > 0) {
        filtered = filtered.filter(e =>
            !filters.excludedCategories.includes(inferCategory(e))
        );
    }

    filtered = filtered.filter(e => {
        const endDate = new Date(e.end_date);
        const isClosed = e.closed === true;
        return endDate >= now && !isClosed;
    });

    if (filters.timeRemaining !== 'all') {
        const days = parseInt(String(filters.timeRemaining));
        const maxDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(e => {
            const endDate = new Date(e.end_date);
            return endDate <= maxDate;
        });
    }

    if (filters.minVolume > 0) {
        filtered = filtered.filter(e => parseFloat(String(e.volume)) >= filters.minVolume);
    }

    if (filters.minLiquidity > 0) {
        filtered = filtered.filter(e => parseFloat(String(e.volume)) * 0.1 >= filters.minLiquidity);
    }

    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(e =>
            e.title?.toLowerCase().includes(query) ||
            e.title_ko?.toLowerCase().includes(query) ||
            e.category?.toLowerCase().includes(query)
        );
    }

    return filtered;
}
