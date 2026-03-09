import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/config.ts';
import { categoryColors } from '../src/constants.ts';

// ─── State ───
let supabaseClient: SupabaseClient | null = null;
let adminEvents: Record<string, unknown>[] = [];
let currentPage = 1;
let totalCount = 0;
let editingEventId: string | null = null;
const PAGE_SIZE = 50;

let searchQuery = '';
let excludedCategories: string[] = [];
let translationFilter = '';
let hiddenFilter = '';
let sortField = 'volume';

// ─── 초기화 ───

function initSupabase(): void {
    if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
        console.error('Supabase 설정이 없습니다. config.js를 확인하세요.');
        return;
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

document.addEventListener('DOMContentLoaded', async () => {
    initSupabase();
    if (!supabaseClient) return;

    setupEventListeners();
    await checkAuth();
});

async function checkAuth(): Promise<void> {
    const { data: { session } } = await supabaseClient!.auth.getSession();
    if (session) {
        showDashboard();
    } else {
        showLoginGate();
    }

    supabaseClient!.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') showDashboard();
        if (event === 'SIGNED_OUT') showLoginGate();
    });
}

function showLoginGate(): void {
    (document.getElementById('loginGate') as HTMLElement).style.display = 'flex';
    (document.getElementById('adminDashboard') as HTMLElement).style.display = 'none';
}

async function showDashboard(): Promise<void> {
    (document.getElementById('loginGate') as HTMLElement).style.display = 'none';
    (document.getElementById('adminDashboard') as HTMLElement).style.display = 'block';
    await loadStats();
    await loadData();
}

// ─── 이벤트 리스너 ───

function setupEventListeners(): void {
    document.getElementById('loginForm')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('loginError')!;
        errorEl.textContent = '';
        try {
            const { error } = await supabaseClient!.auth.signInWithPassword({
                email: (document.getElementById('adminEmail') as HTMLInputElement).value,
                password: (document.getElementById('adminPassword') as HTMLInputElement).value
            });
            if (error) throw error;
        } catch (err: unknown) {
            errorEl.textContent = (err as Error).message;
        }
    });

    document.getElementById('signOutBtn')!.addEventListener('click', async () => {
        await supabaseClient!.auth.signOut();
    });

    (document.getElementById('adminSearch') as HTMLInputElement).addEventListener('input', debounce((e: Event) => {
        searchQuery = (e.target as HTMLInputElement).value.trim();
        currentPage = 1;
        loadData();
    }, 300));

    initCategoryChips();

    document.querySelectorAll('.admin-chip[data-filter="translation"]').forEach(chip => {
        chip.addEventListener('click', () => {
            translationFilter = (chip as HTMLElement).dataset.value!;
            currentPage = 1;
            updateChipGroup('translation', chip as HTMLElement);
            loadData();
        });
    });

    document.querySelectorAll('.admin-chip[data-filter="hidden"]').forEach(chip => {
        chip.addEventListener('click', () => {
            hiddenFilter = (chip as HTMLElement).dataset.value!;
            currentPage = 1;
            updateChipGroup('hidden', chip as HTMLElement);
            loadData();
        });
    });

    document.querySelectorAll('.admin-chip[data-filter="sort"]').forEach(chip => {
        chip.addEventListener('click', () => {
            sortField = (chip as HTMLElement).dataset.value!;
            currentPage = 1;
            updateChipGroup('sort', chip as HTMLElement);
            loadData();
        });
    });

    document.getElementById('editModalOverlay')!.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditModal();
    });
    document.getElementById('editModalClose')!.addEventListener('click', closeEditModal);
    document.getElementById('editCancel')!.addEventListener('click', closeEditModal);
    document.getElementById('editSave')!.addEventListener('click', saveEdit);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeEditModal();
    });
}

function initCategoryChips(): void {
    const container = document.getElementById('categoryChips');
    if (!container) return;

    Object.keys(categoryColors).forEach(cat => {
        if (cat === 'default') return;
        const color = categoryColors[cat];
        const chip = document.createElement('button');
        chip.className = 'admin-chip';
        chip.dataset.category = cat;
        chip.innerHTML = `<span class="chip-color-dot" style="background:${color};"></span>${cat}`;
        chip.addEventListener('click', () => {
            toggleCategoryExclusion(cat);
        });
        container.appendChild(chip);
    });
}

function toggleCategoryExclusion(category: string): void {
    const idx = excludedCategories.indexOf(category);
    if (idx > -1) {
        excludedCategories.splice(idx, 1);
    } else {
        excludedCategories.push(category);
    }
    currentPage = 1;
    updateCategoryChipStyles();
    loadData();
}

function updateCategoryChipStyles(): void {
    document.querySelectorAll('#categoryChips .admin-chip').forEach(chip => {
        const cat = (chip as HTMLElement).dataset.category;
        if (cat) chip.classList.toggle('excluded', excludedCategories.includes(cat));
    });
}

function updateChipGroup(filterName: string, activeChip: HTMLElement): void {
    document.querySelectorAll(`.admin-chip[data-filter="${filterName}"]`).forEach(chip => {
        chip.classList.toggle('active', chip === activeChip);
    });
}

// ─── 데이터 ───

async function loadStats(): Promise<void> {
    try {
        const now = new Date().toISOString();
        const [totalRes, translatedRes, hiddenRes] = await Promise.all([
            supabaseClient!.from('poly_events').select('id', { count: 'exact', head: true }).gte('end_date', now).eq('closed', false),
            supabaseClient!.from('poly_events').select('id', { count: 'exact', head: true }).gte('end_date', now).eq('closed', false).not('title_ko', 'is', null),
            supabaseClient!.from('poly_events').select('id', { count: 'exact', head: true }).gte('end_date', now).eq('hidden', true),
        ]);
        const total = totalRes.count || 0;
        const translated = translatedRes.count || 0;
        const hidden = hiddenRes.count || 0;
        document.getElementById('statTotal')!.textContent = total.toLocaleString();
        document.getElementById('statTranslated')!.textContent = translated.toLocaleString();
        document.getElementById('statUntranslated')!.textContent = (total - translated).toLocaleString();
        document.getElementById('statHidden')!.textContent = hidden.toLocaleString();
    } catch (err) {
        console.error('Stats load error:', err);
    }
}

async function loadData(): Promise<void> {
    const loading = document.getElementById('loadingIndicator') as HTMLElement;
    loading.style.display = 'block';

    try {
        const now = new Date().toISOString();
        let query = supabaseClient!
            .from('poly_events')
            .select('id, title, title_ko, slug, event_slug, category, volume, end_date, hidden, description, description_ko, tags', { count: 'exact' })
            .gte('end_date', now)
            .eq('closed', false);

        if (excludedCategories.length > 0) {
            query = query.not('category', 'in', `(${excludedCategories.join(',')})`);
        }
        if (translationFilter === 'translated') {
            query = query.not('title_ko', 'is', null);
        } else if (translationFilter === 'untranslated') {
            query = query.is('title_ko', null);
        }
        if (hiddenFilter === 'visible') {
            query = query.eq('hidden', false);
        } else if (hiddenFilter === 'hidden') {
            query = query.eq('hidden', true);
        }

        if (searchQuery) {
            const safeQ = searchQuery.replace(/[%_\\]/g, c => '\\' + c);
            query = query.or(`title.ilike.%${safeQ}%,title_ko.ilike.%${safeQ}%`);
        }

        if (sortField === 'volume') {
            query = query.order('volume', { ascending: false });
        } else if (sortField === 'end_date') {
            query = query.order('end_date', { ascending: true });
        } else if (sortField === 'title') {
            query = query.order('title', { ascending: true });
        }

        const from = (currentPage - 1) * PAGE_SIZE;
        query = query.range(from, from + PAGE_SIZE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        adminEvents = (data || []) as Record<string, unknown>[];
        totalCount = count || 0;
        renderTable();
        renderPagination();
    } catch (err: unknown) {
        console.error('Data load error:', err);
        showToast('데이터 로드 실패: ' + (err as Error).message, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

// ─── 렌더링 ───

function renderTable(): void {
    const tbody = document.getElementById('marketTableBody')!;

    if (adminEvents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">결과 없음</td></tr>`;
        return;
    }

    tbody.innerHTML = adminEvents.map(event => {
        const isHidden = event.hidden === true;
        const hasTranslation = !!event.title_ko;
        const volume = formatVolume(event.volume as number);
        const endDate = formatDate(event.end_date as string);
        const safeId = escapeHtml(event.id as string);

        return `
            <tr class="${isHidden ? 'row-hidden' : ''}">
                <td class="col-toggle" style="text-align:center;">
                    <label class="toggle-switch">
                        <input type="checkbox" ${!isHidden ? 'checked' : ''} data-event-id="${safeId}" data-action="toggle-hidden">
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td class="title-cell" title="${escapeHtml(event.title as string)}">${escapeHtml(event.title as string)}</td>
                <td class="title-ko-cell ${hasTranslation ? '' : 'empty'}" title="${escapeHtml((event.title_ko as string) || '')}">
                    ${hasTranslation ? escapeHtml(event.title_ko as string) : '(미번역)'}
                </td>
                <td><span class="category-badge">${escapeHtml((event.category as string) || '-')}</span></td>
                <td class="volume-cell">${volume}</td>
                <td style="font-size:0.8rem;color:var(--text-secondary);">${endDate}</td>
                <td style="text-align:center;">
                    <button class="btn-edit" data-event-id="${safeId}" data-action="edit">편집</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-action="toggle-hidden"]').forEach(input => {
        input.addEventListener('change', function(this: HTMLInputElement) {
            toggleHidden(this.dataset.eventId!, !this.checked);
        });
    });
    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', function(this: HTMLElement) {
            openEditModal(this.dataset.eventId!);
        });
    });
}

function renderPagination(): void {
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const el = document.getElementById('pagination')!;

    if (totalPages <= 1) {
        el.innerHTML = `<span class="page-info">${totalCount.toLocaleString()}개 시장</span>`;
        return;
    }

    let html = '';
    html += `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>&laquo;</button>`;

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);

    if (start > 1) {
        html += `<button class="page-btn" data-page="1">1</button>`;
        if (start > 2) html += `<span class="page-info">...</span>`;
    }

    for (let i = start; i <= end; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (end < totalPages) {
        if (end < totalPages - 1) html += `<span class="page-info">...</span>`;
        html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>&raquo;</button>`;
    html += `<span class="page-info">${totalCount.toLocaleString()}개 시장</span>`;

    el.innerHTML = html;
    el.querySelectorAll('.page-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', function(this: HTMLElement) {
            goToPage(parseInt(this.dataset.page!, 10));
        });
    });
}

// ─── 액션 ───

async function toggleHidden(eventId: string, hidden: boolean): Promise<void> {
    try {
        const { error } = await supabaseClient!.from('poly_events').update({ hidden }).eq('id', eventId);
        if (error) throw error;
        const event = adminEvents.find(e => e.id === eventId);
        if (event) event.hidden = hidden;
        renderTable();
        invalidateCalendarCache();
        showToast(hidden ? '시장이 숨김 처리되었습니다' : '시장이 노출되었습니다', 'success');
        loadStats();
    } catch (err: unknown) {
        showToast('오류: ' + (err as Error).message, 'error');
    }
}

function openEditModal(eventId: string): void {
    const event = adminEvents.find(e => e.id === eventId);
    if (!event) return;
    editingEventId = eventId;
    document.getElementById('editTitleEn')!.textContent = (event.title as string) || '';
    (document.getElementById('editTitleKo') as HTMLInputElement).value = (event.title_ko as string) || '';
    (document.getElementById('editCategory') as HTMLSelectElement).value = (event.category as string) || 'Uncategorized';
    document.getElementById('editDescription')!.textContent = (event.description as string) || '(설명 없음)';
    (document.getElementById('editDescriptionKo') as HTMLTextAreaElement).value = (event.description_ko as string) || '';

    const linkEl = document.getElementById('editPolyLink') as HTMLAnchorElement | null;
    if (linkEl) {
        const slug = (event.slug as string) || '';
        if (slug) {
            linkEl.href = `https://polymarket.com/event/${slug}`;
            linkEl.style.display = 'inline';
        } else {
            linkEl.style.display = 'none';
        }
    }

    document.getElementById('editModalOverlay')!.classList.add('active');
}

function closeEditModal(): void {
    editingEventId = null;
    document.getElementById('editModalOverlay')!.classList.remove('active');
}

async function saveEdit(): Promise<void> {
    if (!editingEventId) return;
    const saveBtn = document.getElementById('editSave') as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
        const updates = {
            title_ko: (document.getElementById('editTitleKo') as HTMLInputElement).value.trim() || null,
            category: (document.getElementById('editCategory') as HTMLSelectElement).value,
            description_ko: (document.getElementById('editDescriptionKo') as HTMLTextAreaElement).value.trim() || null,
        };

        const { error } = await supabaseClient!.from('poly_events').update(updates).eq('id', editingEventId);
        if (error) throw error;

        const event = adminEvents.find(e => e.id === editingEventId);
        if (event) Object.assign(event, updates);

        renderTable();
        invalidateCalendarCache();
        closeEditModal();
        showToast('저장 완료', 'success');
        loadStats();
    } catch (err: unknown) {
        showToast('저장 실패: ' + (err as Error).message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
    }
}

// ─── 유틸리티 ───

function goToPage(page: number): void {
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    loadData();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatVolume(vol: number): string {
    const v = parseFloat(String(vol)) || 0;
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
}

function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const date = d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} ${time}`;
}

function escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout>;
    return function (this: unknown, ...args: Parameters<T>) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
    const toast = document.getElementById('toast')!;
    toast.textContent = message;
    toast.className = `admin-toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function invalidateCalendarCache(): void {
    try {
        localStorage.removeItem('polymarket_events_cache');
        localStorage.removeItem('polymarket_cache_time');
    } catch (e) { /* ignore */ }
    bumpCacheVersion();
}

async function bumpCacheVersion(): Promise<void> {
    try {
        await supabaseClient!.from('cache_meta').update({ last_updated: new Date().toISOString() }).eq('id', 1);
    } catch (e) {
        console.warn('cache_meta 업데이트 실패:', e);
    }
}
