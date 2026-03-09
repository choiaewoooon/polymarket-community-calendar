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
}
