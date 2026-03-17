/**
 * 차트 Health Check HTML 보고서 생성기
 * 실행: npx vitest run --reporter=json --outputFile=test-results.json && npx tsx scripts/generate-test-report.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

interface TestResult {
    assertionResults: Array<{
        fullName: string;
        status: 'passed' | 'failed';
        duration: number;
        failureMessages: string[];
    }>;
    name: string;
    status: string;
    startTime: number;
    endTime: number;
}

interface VitestJson {
    numPassedTests: number;
    numFailedTests: number;
    numTotalTests: number;
    startTime: number;
    testResults: TestResult[];
}

const jsonPath = resolve(process.cwd(), 'test-results.json');
const raw = readFileSync(jsonPath, 'utf-8');
const data: VitestJson = JSON.parse(raw);

const passed = data.numPassedTests;
const failed = data.numFailedTests;
const total = data.numTotalTests;
const allPassed = failed === 0;
const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const duration = data.testResults.reduce((sum, r) => sum + (r.endTime - r.startTime), 0);

// 테스트를 그룹별로 묶기
const groups: Record<string, Array<{ name: string; status: string; duration: number; error?: string }>> = {};
for (const file of data.testResults) {
    for (const t of file.assertionResults) {
        const parts = t.fullName.split(' > ');
        const group = parts.length > 1 ? parts[0] : '기타';
        const name = parts.slice(1).join(' > ') || t.fullName;
        if (!groups[group]) groups[group] = [];
        groups[group].push({
            name,
            status: t.status,
            duration: t.duration,
            error: t.failureMessages?.join('\n') || undefined,
        });
    }
}

const statusEmoji = (s: string) => s === 'passed' ? '✅' : '❌';
const statusClass = (s: string) => s === 'passed' ? 'pass' : 'fail';

const groupsHtml = Object.entries(groups).map(([groupName, tests]) => {
    const groupPassed = tests.every(t => t.status === 'passed');
    const testsHtml = tests.map(t => `
        <tr class="${statusClass(t.status)}">
            <td>${statusEmoji(t.status)}</td>
            <td>${t.name}</td>
            <td class="mono">${t.duration}ms</td>
            ${t.error ? `</tr><tr class="error-row"><td colspan="3"><pre>${t.error}</pre></td>` : ''}
        </tr>
    `).join('');

    return `
        <div class="group">
            <div class="group-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span class="group-icon">${groupPassed ? '✅' : '🚨'}</span>
                <span class="group-name">${groupName}</span>
                <span class="group-count">${tests.filter(t => t.status === 'passed').length}/${tests.length}</span>
                <span class="chevron">▾</span>
            </div>
            <table class="test-table">
                <tbody>${testsHtml}</tbody>
            </table>
        </div>
    `;
}).join('');

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>차트 Health Check 보고서</title>
<style>
    :root {
        --bg: #0a0a0f;
        --bg-card: #12121a;
        --bg-hover: #1a1a2e;
        --border: #2a2a3e;
        --text: #e0e0e8;
        --text-muted: #8888a0;
        --green: #22c55e;
        --green-bg: rgba(34, 197, 94, 0.08);
        --red: #ef4444;
        --red-bg: rgba(239, 68, 68, 0.08);
        --cyan: #06b6d4;
        --orange: #f59e0b;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: var(--bg);
        color: var(--text);
        padding: 24px;
        max-width: 800px;
        margin: 0 auto;
    }

    /* 헤더 */
    .header {
        text-align: center;
        padding: 32px 0;
        border-bottom: 1px solid var(--border);
        margin-bottom: 24px;
    }
    .header h1 {
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.5px;
        margin-bottom: 8px;
    }
    .header .subtitle {
        color: var(--text-muted);
        font-size: 13px;
    }

    /* 상태 배너 */
    .status-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 24px;
        font-size: 18px;
        font-weight: 700;
    }
    .status-banner.ok {
        background: var(--green-bg);
        border: 1px solid rgba(34, 197, 94, 0.2);
        color: var(--green);
    }
    .status-banner.bad {
        background: var(--red-bg);
        border: 1px solid rgba(239, 68, 68, 0.2);
        color: var(--red);
    }
    .status-banner .big-icon { font-size: 32px; }

    /* 요약 카드 */
    .summary {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 24px;
    }
    .summary-card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 16px;
        text-align: center;
    }
    .summary-card .value {
        font-size: 28px;
        font-weight: 700;
        font-family: 'SF Mono', Menlo, monospace;
    }
    .summary-card .label {
        font-size: 11px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 4px;
    }
    .summary-card .value.green { color: var(--green); }
    .summary-card .value.red { color: var(--red); }
    .summary-card .value.cyan { color: var(--cyan); }

    /* 그룹 */
    .group {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 10px;
        margin-bottom: 12px;
        overflow: hidden;
    }
    .group-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        cursor: pointer;
        user-select: none;
        transition: background 0.15s;
    }
    .group-header:hover { background: var(--bg-hover); }
    .group-name { flex: 1; font-weight: 600; font-size: 14px; }
    .group-count {
        font-family: 'SF Mono', Menlo, monospace;
        font-size: 12px;
        color: var(--text-muted);
        background: var(--bg);
        padding: 2px 8px;
        border-radius: 6px;
    }
    .chevron {
        color: var(--text-muted);
        transition: transform 0.2s;
        font-size: 12px;
    }
    .group.collapsed .test-table { display: none; }
    .group.collapsed .chevron { transform: rotate(-90deg); }

    /* 테스트 테이블 */
    .test-table {
        width: 100%;
        border-collapse: collapse;
    }
    .test-table tr {
        border-top: 1px solid var(--border);
    }
    .test-table td {
        padding: 10px 16px;
        font-size: 13px;
    }
    .test-table td:first-child { width: 28px; text-align: center; }
    .test-table td:last-child { width: 60px; text-align: right; }
    .test-table .mono {
        font-family: 'SF Mono', Menlo, monospace;
        color: var(--text-muted);
        font-size: 11px;
    }
    .test-table tr.pass:hover { background: var(--green-bg); }
    .test-table tr.fail { background: var(--red-bg); }
    .error-row pre {
        font-size: 11px;
        color: var(--red);
        white-space: pre-wrap;
        padding: 8px;
        background: rgba(0,0,0,0.3);
        border-radius: 6px;
    }

    /* 푸터 */
    .footer {
        text-align: center;
        padding: 24px 0;
        color: var(--text-muted);
        font-size: 11px;
        border-top: 1px solid var(--border);
        margin-top: 24px;
    }
    .footer a { color: var(--cyan); text-decoration: none; }
</style>
</head>
<body>

<div class="header">
    <h1>차트 Health Check 보고서</h1>
    <div class="subtitle">폴리마켓 커뮤니티 — 라이브 트래커 차트 무한 로딩 방지 테스트</div>
</div>

<div class="status-banner ${allPassed ? 'ok' : 'bad'}">
    <span class="big-icon">${allPassed ? '🛡️' : '🚨'}</span>
    ${allPassed ? '모든 테스트 통과 — 차트 안전' : `${failed}개 테스트 실패 — 확인 필요`}
</div>

<div class="summary">
    <div class="summary-card">
        <div class="value cyan">${total}</div>
        <div class="label">전체</div>
    </div>
    <div class="summary-card">
        <div class="value green">${passed}</div>
        <div class="label">통과</div>
    </div>
    <div class="summary-card">
        <div class="value ${failed > 0 ? 'red' : 'green'}">${failed}</div>
        <div class="label">실패</div>
    </div>
    <div class="summary-card">
        <div class="value">${duration}ms</div>
        <div class="label">소요시간</div>
    </div>
</div>

${groupsHtml}

<div class="footer">
    ${now} KST 생성 · <a href="https://polymarket-calender.vercel.app">polymarket-calender.vercel.app</a>
</div>

</body>
</html>`;

const outPath = resolve(process.cwd(), 'test-report.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`\n✅ 보고서 생성 완료: ${outPath}`);
console.log(`   브라우저에서 열기: open test-report.html\n`);
