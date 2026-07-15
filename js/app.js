import { supabase } from './supabaseClient.js';
import { getSession, getCurrentUserProfile, loginWithPassword, logout } from './auth.js';
import { initSignup } from './signup.js';
import { showWelcomeModal } from './welcome.js';
import { renderCompanyHighlight, initCompanySubtabs } from './tab-company.js';
import { renderJobseekerDashboard } from './jobseeker-dashboard.js';
import {
  renderMainHighlight,
  renderRecentJobs,
  renderRecentTalent,
  renderJobNews,
  initHeroSearch,
  renderMainTrend,
  renderSkillRanking,
  renderSkillCombo,
  renderWantedTrend,
} from './tab-main.js';
import { escapeHtml, tabForRole } from './utils.js';

const tabButtons = document.querySelectorAll('.tab');
const panels = {
  start: document.getElementById('panel-start'),
  main: document.getElementById('panel-main'),
  company: document.getElementById('panel-company'),
  jobseeker: document.getElementById('panel-jobseeker'),
  signup: document.getElementById('panel-signup'),
};
const authBar = document.getElementById('auth-bar');
const signupEntryBtn = document.getElementById('signup-entry-btn');
const companyHighlightEl = document.getElementById('company-highlight');

// "메인" 탭은 로그인 회원 전용 종합 대시보드다(회원 유인 전략, 2026-07-14 결정).
// 비로그인 방문자에게는 main-member-gate(가입 유도)만 보여주고, common에서 이식한 실제
// 위젯(main-dashboard)은 로그인 세션이 있을 때만 채운다.
const mainGateEl = document.getElementById('main-member-gate');
const mainDashboardEl = document.getElementById('main-dashboard');
const mainEls = {
  highlight: document.getElementById('main-highlight-carousel'),
  recentJobs: document.getElementById('main-recent-jobs'),
  recentTalent: document.getElementById('main-recent-talent'),
  news: document.getElementById('main-news'),
  trend: document.getElementById('main-trend'),
  wantedTrend: document.getElementById('main-wanted-trend'),
  skillRanking: document.getElementById('main-skill-ranking'),
  skillCombo: document.getElementById('main-skill-combo'),
};

async function renderMainDashboard() {
  const session = await getSession();

  if (!session) {
    if (mainGateEl) mainGateEl.hidden = false;
    if (mainDashboardEl) mainDashboardEl.hidden = true;
    return;
  }

  if (mainGateEl) mainGateEl.hidden = true;
  if (mainDashboardEl) mainDashboardEl.hidden = false;

  renderMainHighlight(mainEls.highlight);
  renderRecentJobs(mainEls.recentJobs);
  renderRecentTalent(mainEls.recentTalent);
  renderJobNews(mainEls.news);
  renderMainTrend(mainEls.trend);
  renderWantedTrend(mainEls.wantedTrend);
  renderSkillRanking(mainEls.skillRanking);
  renderSkillCombo(mainEls.skillCombo);
}

function setActiveTab(tabName) {
  tabButtons.forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tabName));
  });

  Object.entries(panels).forEach(([name, el]) => {
    if (!el) return;
    el.hidden = name !== tabName;
  });

  if (tabName === 'main') {
    renderMainDashboard();
  }
  if (tabName === 'company') {
    renderCompanyHighlight(companyHighlightEl);
    initCompanySubtabs();
  }
  if (tabName === 'jobseeker') {
    renderJobseekerDashboard();
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

document.querySelector('.logo')?.addEventListener('click', (e) => {
  e.preventDefault();
  setActiveTab('start');
});

signupEntryBtn?.addEventListener('click', () => setActiveTab('signup'));
document.querySelectorAll('[data-goto-signup]').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab('signup'));
});

function renderAuthBar(session) {
  if (!session) {
    authBar.innerHTML = `
      <form id="login-form" class="login-form" novalidate>
        <label class="sr-only" for="login-email">이메일</label>
        <input class="form-input form-input--sm" type="email" id="login-email" placeholder="이메일" required autocomplete="email" />
        <label class="sr-only" for="login-password">비밀번호</label>
        <input class="form-input form-input--sm" type="password" id="login-password" placeholder="비밀번호" required autocomplete="current-password" />
        <button type="submit" class="btn btn-secondary">로그인</button>
      </form>
      <button type="button" class="btn btn-primary" id="signup-entry-btn-header">회원가입</button>
    `;

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const { error } = await loginWithPassword(email, password);
      if (error) {
        window.alert(`로그인에 실패했습니다: ${error.message}`);
        return;
      }

      // 로그인 성공 시에도 회원가입과 동일하게 환영 모달 → 본인 역할 탭 이동으로 연결한다.
      const profile = await getCurrentUserProfile();
      const role = profile?.userType || null;
      showWelcomeModal({
        role,
        mode: 'login',
        onContinue: () => setActiveTab(tabForRole(role)),
      });
    });
    document.getElementById('signup-entry-btn-header').addEventListener('click', () => setActiveTab('signup'));
    return;
  }

  // XSS 수정(2026-07-14): session.user.email을 이스케이프 없이 넣던 것을 escapeHtml로 교체.
  authBar.innerHTML = `
    <span class="auth-user">${escapeHtml(session.user.email)}</span>
    <button type="button" class="btn btn-ghost" id="logout-btn">로그아웃</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', () => logout());
}

function refreshActiveTabContent() {
  const activeTab = document.querySelector('.tab[aria-selected="true"]')?.dataset.tab;
  if (activeTab === 'main') renderMainDashboard();
  if (activeTab === 'company') {
    renderCompanyHighlight(companyHighlightEl);
    initCompanySubtabs();
  }
  if (activeTab === 'jobseeker') renderJobseekerDashboard();
}

initSignup({
  onSuccess: (userType) => {
    showWelcomeModal({
      role: userType,
      mode: 'signup',
      onContinue: () => setActiveTab(tabForRole(userType)),
    });
  },
});

// 히어로 검색 폼은 main-dashboard(로그인 전엔 hidden) 안에 있지만, DOM 자체는 항상 존재하므로
// 앱 시작 시 1회만 초기화해 직무/지역 select를 미리 채워둔다(common과 동일 패턴).
initHeroSearch();

supabase.auth.onAuthStateChange((_event, session) => {
  renderAuthBar(session);
  refreshActiveTabContent();
});

(async () => {
  const session = await getSession();
  renderAuthBar(session);
  setActiveTab('start');
})();
