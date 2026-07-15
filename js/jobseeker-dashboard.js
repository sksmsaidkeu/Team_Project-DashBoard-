import { supabase } from './supabaseClient.js';
import { getCurrentUserProfile } from './auth.js';
import {
  getApplications,
  getInsights,
  getTrendingSkills,
  getRecommendations,
  getNews,
} from './api/jobseeker.js';

// FEATURE_JOBSEEKER.md #6~10: Tab2 대시보드(칸반/인사이트/핫스킬/추천공고/뉴스/인사배너)를
// 실 데이터로 렌더링한다. 각 섹션은 독립적으로 성공/실패를 표시한다(Promise.allSettled) —
// 예를 들어 news 테이블이 비어 있거나 한 API가 실패해도 나머지 섹션은 정상 렌더링되어야 한다.

// DESIGN.md 5.7절 파이프라인 4단계 + 최종결과 확정 시 합격/불합격 분기.
// 2026-07-16: 이 값들은 더 이상 구직자가 직접 바꿀 수 없다(회사가 채용 프로세스 단계를
// 결정하는 게 맞다 — RLS도 구직자의 UPDATE 권한을 제거했다, migrations/
// 20260716000000_jobseeker_applications_company_owns_stage.sql 참고). 여기서는 카드에
// 현재 단계 라벨을 표시하는 용도로만 쓴다(읽기 전용).
const STAGE_OPTIONS = [
  { value: 'applied', label: '지원완료', pipeline_stage: 'applied', outcome: null },
  { value: 'review', label: '서류심사', pipeline_stage: 'review', outcome: null },
  { value: 'interview', label: '면접', pipeline_stage: 'interview', outcome: null },
  { value: 'result_passed', label: '최종결과 · 합격', pipeline_stage: 'result', outcome: 'passed' },
  { value: 'result_rejected', label: '최종결과 · 불합격', pipeline_stage: 'result', outcome: 'rejected' },
];

const STAGE_DEFS = [
  { key: 'applied', label: '지원완료', headerClass: 'stage-1' },
  { key: 'review', label: '서류심사', headerClass: 'stage-2' },
  { key: 'interview', label: '면접', headerClass: 'stage-3' },
  { key: 'result', label: '최종결과', headerClass: 'stage-4' },
];

function stageOptionValue(stageKey, outcome) {
  if (stageKey === 'result') return outcome === 'rejected' ? 'result_rejected' : 'result_passed';
  return stageKey;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// news.url은 회사/운영자가 수동 등록한 값이라 href에 그대로 꽂으면 javascript: 스킴 등으로
// XSS가 가능하다 — http/https만 허용한다.
function safeHref(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    /* invalid URL */
  }
  return '#';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return '방금 전';
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function formatStatValue(stat) {
  if (stat.label === '합격률') return `${stat.value}%`;
  return `${stat.value}건`;
}

export async function renderJobseekerDashboard() {
  const els = {
    greeting: document.getElementById('jobseeker-greeting'),
    kanban: document.getElementById('jobseeker-kanban'),
    insights: document.getElementById('jobseeker-insights'),
    trending: document.getElementById('jobseeker-trending-skills'),
    recommendations: document.getElementById('jobseeker-recommendations'),
    news: document.getElementById('jobseeker-news'),
  };
  // panel-jobseeker가 아직 DOM에 없거나(다른 페이지) 이미 다른 코드로 대체된 경우 조용히 종료.
  if (!els.kanban) return;

  let session;
  try {
    session = await getCurrentUserProfile();
  } catch (err) {
    console.error('getCurrentUserProfile error', err);
    session = null;
  }

  if (!session || session.userType !== 'JOBSEEKER' || !session.profile) {
    const message = !session
      ? '로그인 후 대시보드를 확인할 수 있습니다.'
      : '구직자 회원만 이용할 수 있는 화면입니다.';
    Object.values(els).forEach((el) => {
      if (el) el.innerHTML = `<p class="empty-state">${message}</p>`;
    });
    return;
  }

  const profile = session.profile;

  const [nameResult, applicationsResult, insightsResult, trendingResult, recommendationsResult, newsResult] =
    await Promise.allSettled([
      supabase.from('users').select('name').eq('id', session.authUser.id).maybeSingle(),
      getApplications(),
      getInsights(),
      getTrendingSkills(),
      getRecommendations(),
      getNews(),
    ]);

  const displayName = nameResult.status === 'fulfilled' ? nameResult.value.data?.name ?? null : null;

  renderGreeting(els.greeting, displayName, insightsResult);
  renderKanban(els.kanban, applicationsResult);
  renderInsights(els.insights, insightsResult);
  renderTrendingSkills(els.trending, trendingResult);
  renderRecommendations(els.recommendations, recommendationsResult, profile.id);
  renderNews(els.news, newsResult);
}

function renderGreeting(el, displayName, insightsResult) {
  if (!el) return;
  const stats = insightsResult.status === 'fulfilled' ? insightsResult.value.stats ?? [] : [];
  const chipsHtml = stats
    .map((s) => `<span class="greeting-banner__chip">${escapeHtml(s.label)} ${escapeHtml(formatStatValue(s))}</span>`)
    .join(' ');

  el.innerHTML = `
    <div class="greeting-banner">
      <p class="greeting-banner__title">${displayName ? `${escapeHtml(displayName)}님, ` : ''}이번 주 지원 현황입니다</p>
      ${chipsHtml}
    </div>
  `;
}

function renderKanban(el, applicationsResult) {
  if (!el) return;
  if (applicationsResult.status !== 'fulfilled') {
    el.innerHTML = '<p class="empty-state">지원 현황을 불러오지 못했습니다.</p>';
    return;
  }

  const stages = applicationsResult.value.stages ?? [];

  el.innerHTML = STAGE_DEFS.map((def) => {
    const stage = stages.find((s) => s.stage_key === def.key) ?? { count: 0, cards: [] };
    const cardsHtml = stage.cards.length === 0
      ? '<p class="empty-state">아직 지원한 공고가 없어요.</p>'
      : stage.cards.map((card) => renderCard(card, def.key)).join('');

    return `
      <div class="kanban-col">
        <div class="col-header ${def.headerClass}">
          <span>${def.label}</span>
          <span class="count">${stage.count}</span>
        </div>
        ${cardsHtml}
      </div>
    `;
  }).join('');
}

function renderCard(card, stageKey) {
  const outcomeClass = card.outcome === 'passed' ? 'success' : card.outcome === 'rejected' ? 'error' : '';
  const skillsHtml = (card.skills ?? [])
    .map((s) => `<span class="skill">${escapeHtml(s)}</span>`)
    .join('');
  const currentStageValue = stageOptionValue(stageKey, card.outcome);
  const currentStageLabel = STAGE_OPTIONS.find((o) => o.value === currentStageValue)?.label ?? '';

  // DESIGN.md 7.2절: 합격/불합격처럼 색으로만 구분되는 상태는 배경색(job-card.success/.error)
  // 단독이 아니라 텍스트/아이콘 라벨을 항상 함께 표기한다(.job-footer/.status-badge, 색맹 대응).
  const outcomeBadgeHtml = card.outcome
    ? `<div class="job-footer">
        <span class="status-badge ${card.outcome === 'passed' ? 'status-success' : 'status-error'}">
          ${card.outcome === 'passed' ? '✓ 합격' : '✕ 불합격'}
        </span>
      </div>`
    : '';

  return `
    <div class="job-card ${outcomeClass}">
      <div class="job-company">${escapeHtml(card.company_name)}</div>
      <div class="job-role">${escapeHtml(card.job_title)}</div>
      <div class="job-date">${formatDate(card.applied_at)}</div>
      ${skillsHtml ? `<div class="job-skills">${skillsHtml}</div>` : ''}
      ${outcomeBadgeHtml}
      <p class="job-stage-readonly">현재 단계: <strong>${escapeHtml(currentStageLabel)}</strong>
        <span class="sr-only">(기업에서만 변경할 수 있습니다)</span>
      </p>
    </div>
  `;
}

function renderInsights(el, insightsResult) {
  if (!el) return;
  if (insightsResult.status !== 'fulfilled') {
    el.innerHTML = '<p class="empty-state">인사이트를 불러오지 못했습니다.</p>';
    return;
  }

  const stats = insightsResult.value.stats ?? [];
  el.innerHTML = stats.map((s) => `
    <div class="stat-item">
      <span class="stat-label">${escapeHtml(s.label)}</span>
      <span class="stat-value">${escapeHtml(formatStatValue(s))}${s.change ? `<span class="stat-change">${escapeHtml(s.change)}</span>` : ''}</span>
    </div>
  `).join('');
}

function renderTrendingSkills(el, trendingResult) {
  if (!el) return;
  if (trendingResult.status !== 'fulfilled') {
    el.innerHTML = '<p class="empty-state">핫 스킬 정보를 불러오지 못했습니다.</p>';
    return;
  }

  const skills = trendingResult.value.skills ?? [];
  if (skills.length === 0) {
    el.innerHTML = '<p class="empty-state">아직 집계된 스킬 트렌드가 없습니다.</p>';
    return;
  }

  el.innerHTML = skills.map((s) => {
    const meta = s.change_rate == null
      ? `언급 ${s.frequency}건`
      : `<span class="trend-change">${s.change_rate > 0 ? '📈 +' : '📉 '}${s.change_rate}%</span>`;
    return `
      <div class="trend-item">
        <div class="trend-rank">${s.rank}</div>
        <div class="trend-info">
          <div class="trend-name">${escapeHtml(s.name)}</div>
          <div class="trend-meta">${meta}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecommendations(el, recommendationsResult, jobseekerProfileId) {
  if (!el) return;
  if (recommendationsResult.status !== 'fulfilled') {
    el.innerHTML = '<p class="empty-state">추천 공고를 불러오지 못했습니다.</p>';
    return;
  }

  const jobs = recommendationsResult.value.jobs ?? [];
  if (jobs.length === 0) {
    el.innerHTML = '<p class="empty-state">현재 조건에 맞는 추천 공고가 없습니다. 프로필/스킬을 넓혀보세요.</p>';
    return;
  }

  el.innerHTML = jobs.map((job) => `
    <div class="rec-item">
      <div class="match-score" style="--score:${job.match_score}" aria-hidden="true">
        <span class="match-score__value">${job.match_score}%</span>
      </div>
      <span class="sr-only">매칭 점수 ${job.match_score}점</span>
      <div class="rec-title">${escapeHtml(job.title)}</div>
      <div class="rec-meta">${escapeHtml(job.company_name)}<br/>${job.salary_range ? `${escapeHtml(job.salary_range)} · ` : ''}${escapeHtml(job.location)}</div>
      <button type="button" class="rec-btn" data-job-id="${job.id}">지원하기</button>
    </div>
  `).join('');

  el.querySelectorAll('[data-job-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '지원 중...';
      const { error } = await supabase
        .from('jobseeker_applications')
        .insert({ jobseeker_profile_id: jobseekerProfileId, job_posting_id: btn.dataset.jobId });

      if (error) {
        window.alert(`지원에 실패했습니다: ${error.message}`);
        btn.disabled = false;
        btn.textContent = '지원하기';
        return;
      }
      await renderJobseekerDashboard();
    });
  });
}

function renderNews(el, newsResult) {
  if (!el) return;
  if (newsResult.status !== 'fulfilled') {
    el.innerHTML = '<p class="empty-state">뉴스를 불러오지 못했습니다.</p>';
    return;
  }

  const items = newsResult.value.items ?? [];
  if (items.length === 0) {
    el.innerHTML = '<p class="empty-state">등록된 뉴스가 없습니다.</p>';
    return;
  }

  el.innerHTML = items.map((item) => `
    <div class="news-item">
      <a class="news-title" href="${safeHref(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
      <div class="news-source">${escapeHtml(item.source)} · ${formatRelativeTime(item.published_at)}</div>
    </div>
  `).join('');
}
