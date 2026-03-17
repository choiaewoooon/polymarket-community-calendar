/**
 * 차트 무한 로딩 버그 방지 테스트
 *
 * liveTrackerView.ts의 renderSVGChart 핵심 로직을 미러링하여
 * 인덱스 범위 초과, 빈 데이터, 마감 컷 등 엣지 케이스를 검증한다.
 *
 * 실행: npm test
 * 보고서: npm run test:report
 */
import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════
// renderSVGChart 핵심 로직 (미러)
// ═══════════════════════════════════════

const MARKET_CLOSE_HOUR = 21;
const LAYOUT = { padL: 40, padR: 16, padT: 24, padB: 28, plotW: 544, plotH: 148 };

function xOfHour(h: number) {
    return LAYOUT.padL + (Math.min(h, MARKET_CLOSE_HOUR) / MARKET_CLOSE_HOUR) * LAYOUT.plotW;
}

function xOf(i: number, hours: string[]) {
    if (i < 0 || i >= hours.length) return LAYOUT.padL;
    return xOfHour(parseInt(hours[i].split(':')[0]));
}

function yOf(t: number, minT: number, rangeT: number) {
    return LAYOUT.padT + LAYOUT.plotH - ((t - minT) / rangeT) * LAYOUT.plotH;
}

function calcTempRange(temps: number[], overlay: number[] = []) {
    const all = [...temps, ...overlay];
    if (all.length === 0) return { minT: 0, maxT: 1, rangeT: 1 };
    const minT = Math.floor(Math.min(...all) - 2);
    const maxT = Math.ceil(Math.max(...all) + 2);
    return { minT, maxT, rangeT: maxT - minT || 1 };
}

function calcEffectiveLen(hours: string[]) {
    const idx = hours.findIndex(h => parseInt(h.split(':')[0]) > MARKET_CLOSE_HOUR);
    return idx === -1 ? hours.length : idx;
}

function calcNowIdx(hours: string[], effectiveLen: number, nowHour: number) {
    let nowIdx = 0;
    for (let i = 0; i < effectiveLen; i++) {
        if (parseInt(hours[i].split(':')[0]) <= nowHour) nowIdx = i;
    }
    return Math.min(nowIdx, effectiveLen - 1);
}

// ─── 테스트 헬퍼 ───

function makeHours(start: number, end: number) {
    return Array.from({ length: end - start + 1 }, (_, i) => `${start + i}:00`);
}

function makeTemps(count: number, base = 10) {
    return Array.from({ length: count }, (_, i) => base + Math.sin(i) * 5);
}

// ═══════════════════════════════════════
// 테스트
// ═══════════════════════════════════════

describe('xOf — 인덱스 바운드 체크', () => {
    const hours = makeHours(0, 23);

    it('음수 인덱스 → padL 반환 (크래시 없음)', () => {
        expect(xOf(-1, hours)).toBe(LAYOUT.padL);
        expect(xOf(-100, hours)).toBe(LAYOUT.padL);
    });

    it('배열 길이 이상 인덱스 → padL 반환', () => {
        expect(xOf(hours.length, hours)).toBe(LAYOUT.padL);
        expect(xOf(999, hours)).toBe(LAYOUT.padL);
    });

    it('유효 인덱스 → 정상 좌표', () => {
        expect(xOf(0, hours)).toBe(LAYOUT.padL);
        expect(xOf(12, hours)).toBeGreaterThan(LAYOUT.padL);
    });

    it('빈 배열 → 어떤 인덱스든 padL', () => {
        expect(xOf(0, [])).toBe(LAYOUT.padL);
    });

    it('1개짜리 배열 → 인덱스 0만 유효', () => {
        expect(xOf(0, ['12:00'])).toBeGreaterThan(LAYOUT.padL);
        expect(xOf(1, ['12:00'])).toBe(LAYOUT.padL);
    });
});

describe('xOfHour — 21시 마감 클램핑', () => {
    it('21시 이후 → 21시와 동일', () => {
        const x21 = xOfHour(21);
        expect(xOfHour(22)).toBe(x21);
        expect(xOfHour(23)).toBe(x21);
    });

    it('0시 → padL', () => {
        expect(xOfHour(0)).toBe(LAYOUT.padL);
    });

    it('시간 증가 → x값 단조 증가', () => {
        let prev = xOfHour(0);
        for (let h = 1; h <= 21; h++) {
            const curr = xOfHour(h);
            expect(curr).toBeGreaterThan(prev);
            prev = curr;
        }
    });
});

describe('calcEffectiveLen — 21시 마감 컷', () => {
    it('0~23시 → 22개 (0~21시)', () => {
        expect(calcEffectiveLen(makeHours(0, 23))).toBe(22);
    });

    it('0~20시 → 전체', () => {
        expect(calcEffectiveLen(makeHours(0, 20))).toBe(21);
    });

    it('0~21시 → 전체', () => {
        expect(calcEffectiveLen(makeHours(0, 21))).toBe(22);
    });

    it('빈 배열 → 0', () => {
        expect(calcEffectiveLen([])).toBe(0);
    });

    it('22시부터 → 0 (전부 마감 이후)', () => {
        expect(calcEffectiveLen(makeHours(22, 23))).toBe(0);
    });
});

describe('calcNowIdx — 현재 시각 인덱스', () => {
    const hours = makeHours(0, 23);

    it('0시 → 인덱스 0', () => {
        expect(calcNowIdx(hours, 22, 0)).toBe(0);
    });

    it('12시 → 인덱스 12', () => {
        expect(calcNowIdx(hours, 22, 12)).toBe(12);
    });

    it('21시 → 인덱스 21', () => {
        expect(calcNowIdx(hours, 22, 21)).toBe(21);
    });

    it('23시 → effectiveLen-1 이내', () => {
        const effLen = calcEffectiveLen(hours);
        expect(calcNowIdx(hours, effLen, 23)).toBeLessThan(effLen);
    });

    it('빈 데이터 → 0 이하', () => {
        expect(calcNowIdx([], 0, 12)).toBeLessThanOrEqual(0);
    });

    it('6시 시작 + nowHour=3 → 인덱스 0', () => {
        const late = makeHours(6, 18);
        expect(calcNowIdx(late, late.length, 3)).toBe(0);
    });
});

describe('calcTempRange — 온도 범위', () => {
    it('정상 → 범위 > 0', () => {
        expect(calcTempRange([10, 20, 15]).rangeT).toBeGreaterThan(0);
    });

    it('동일 온도 → rangeT > 0 (0 나눗셈 방지)', () => {
        expect(calcTempRange([15, 15, 15]).rangeT).toBe(4);
    });

    it('빈 배열 → 안전한 기본값', () => {
        expect(calcTempRange([]).rangeT).toBeGreaterThan(0);
    });

    it('오버레이 → 범위 확장', () => {
        const base = calcTempRange([10, 15]);
        const ext = calcTempRange([10, 15], [5, 25]);
        expect(ext.minT).toBeLessThanOrEqual(base.minT);
        expect(ext.maxT).toBeGreaterThanOrEqual(base.maxT);
    });
});

describe('yOf — Y좌표', () => {
    it('minT → 하단', () => {
        expect(yOf(5, 5, 10)).toBeCloseTo(LAYOUT.padT + LAYOUT.plotH);
    });

    it('maxT → 상단', () => {
        expect(yOf(15, 5, 10)).toBeCloseTo(LAYOUT.padT);
    });

    it('rangeT=0 → Infinity (calcTempRange에서 방어)', () => {
        expect(Number.isFinite(yOf(10, 10, 0))).toBe(false);
    });
});

describe('통합 시나리오 — 무한 로딩 재현 방지', () => {
    it('nowHour > 마지막 데이터 → 안전', () => {
        const hours = makeHours(0, 5);
        expect(calcNowIdx(hours, calcEffectiveLen(hours), 15)).toBe(5);
    });

    it('22시 이후 전체 데이터 → effectiveLen 올바른 컷', () => {
        const hours = makeHours(0, 23);
        const effLen = calcEffectiveLen(hours);
        const idx = calcNowIdx(hours, effLen, 23);
        expect(idx).toBeLessThan(effLen);
        expect(Number.isFinite(xOf(idx, hours))).toBe(true);
    });

    it('데이터 1개 → 크래시 없음', () => {
        const hours = ['12:00'];
        expect(Number.isFinite(xOf(0, hours))).toBe(true);
    });

    it('빈 데이터 → NaN/Infinity 없음', () => {
        expect(calcEffectiveLen([])).toBe(0);
        expect(calcTempRange([]).rangeT).toBeGreaterThan(0);
        expect(Number.isFinite(xOf(0, []))).toBe(true);
    });

    it('갭 시간 (1,3,6,12,18) → 매핑 안전', () => {
        const hours = ['1:00', '3:00', '6:00', '12:00', '18:00'];
        for (let i = 0; i < hours.length; i++) {
            expect(Number.isFinite(xOf(i, hours))).toBe(true);
        }
    });

    it('0~23시 모든 시간대 → nowIdx 범위 안전', () => {
        const hours = makeHours(0, 23);
        const effLen = calcEffectiveLen(hours);
        for (let h = 0; h <= 23; h++) {
            const idx = calcNowIdx(hours, effLen, h);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(effLen);
        }
    });
});
