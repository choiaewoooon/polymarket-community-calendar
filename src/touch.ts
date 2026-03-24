// ─── 스와이프 감지 유틸리티 ───

export function onSwipe(
    el: HTMLElement,
    callbacks: { onLeft?: () => void; onRight?: () => void },
    threshold = 50
): void {
    let startX = 0;
    let startY = 0;

    el.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;

        // 수평 스와이프만 감지 (수직 스크롤과 충돌 방지)
        if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) callbacks.onLeft?.();
            else callbacks.onRight?.();
        }
    }, { passive: true });
}
