export function initTheme(): void {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

export function toggleTheme(): void {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

export function initDensity(): void {
    const savedDensity = localStorage.getItem('density') || 'comfortable';
    document.documentElement.setAttribute('data-density', savedDensity);
}

export function toggleDensity(): void {
    const html = document.documentElement;
    const currentDensity = html.getAttribute('data-density') || 'comfortable';

    let newDensity: string;
    if (currentDensity === 'comfortable') {
        newDensity = 'compact';
    } else if (currentDensity === 'compact') {
        newDensity = 'spacious';
    } else {
        newDensity = 'comfortable';
    }

    html.setAttribute('data-density', newDensity);
    localStorage.setItem('density', newDensity);
    updateDensityIcon(newDensity);
}

export function updateDensityIcon(density?: string): void {
    const btn = document.getElementById('densityToggle');
    if (!btn) return;
    const d = density || document.documentElement.getAttribute('data-density') || 'comfortable';

    const labels: Record<string, string> = {
        comfortable: '기본',
        compact: '촘촘히',
        spacious: '넓게',
    };
    const tooltips: Record<string, string> = {
        comfortable: '카드 크기: 기본 → 촘촘히',
        compact: '카드 크기: 촘촘히 → 넓게',
        spacious: '카드 크기: 넓게 → 기본',
    };

    // 간격이 다른 가로선 SVG
    const svgs: Record<string, string> = {
        comfortable: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="3" y1="5" x2="21" y2="5"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="19" x2="21" y2="19"/>
        </svg>`,
        compact: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="4" x2="21" y2="4"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="14" x2="21" y2="14"/>
            <line x1="3" y1="19" x2="21" y2="19"/>
        </svg>`,
        spacious: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <line x1="3" y1="7" x2="21" y2="7"/>
            <line x1="3" y1="17" x2="21" y2="17"/>
        </svg>`,
    };

    btn.innerHTML = svgs[d] + `<span class="density-label">${labels[d]}</span>`;
    btn.title = tooltips[d];
}
