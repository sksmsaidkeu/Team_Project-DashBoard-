import { supabase } from './supabaseClient.js';
import { getSession, getCurrentUserProfile, loginWithPassword, logout } from './auth.js';
import { initSignup } from './signup.js';
import { showWelcomeModal } from './welcome.js';
import { renderCompanyHighlight } from './tab-company.js';
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
  main: document.getElementById('panel-main'),
  company: document.getElementById('panel-company'),
  jobseeker: document.getElementById('panel-jobseeker'),
  signup: document.getElementById('panel-signup'),
};
const authBar = document.getElementById('auth-bar');

// 탭 전환마다 매번 재조회하지 않도록 관련 DOM 참조를 모듈 스코프에서 한 번만 캐싱한다.
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
const companyHighlightEl = document.getElementById('company-highlight');

function setActiveTab(tabName) {
  tabButtons.forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tabName));
  });

  Object.entries(panels).forEach(([name, el]) => {
    if (!el) return;
    el.hidden = name !== tabName;
  });

  if (tabName === 'main') {
    renderMainHighlight(mainEls.highlight);
    renderRecentJobs(mainEls.recentJobs);
    renderRecentTalent(mainEls.recentTalent);
    renderJobNews(mainEls.news);
    renderMainTrend(mainEls.trend);
    renderWantedTrend(mainEls.wantedTrend);
    renderSkillRanking(mainEls.skillRanking);
    renderSkillCombo(mainEls.skillCombo);
  }
  if (tabName === 'company') {
    renderCompanyHighlight(companyHighlightEl);
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
  setActiveTab('main');
});

// 메인 히어로의 역할 선택 CTA 카드: 클릭 시 회원가입 탭으로 이동해 해당 역할의
// signup.js 1단계 카드(data-role)를 대신 클릭해 바로 해당 폼으로 진입시킨다.
document.querySelectorAll('[data-role-cta]').forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveTab('signup');
    const role = btn.dataset.roleCta;
    document.querySelector(`.role-card[data-role="${role}"]`)?.click();
  });
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

  authBar.innerHTML = `
    <span class="auth-user">${escapeHtml(session.user.email)}</span>
    <button type="button" class="btn btn-ghost" id="logout-btn">로그아웃</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', () => logout());
}

function refreshActiveTabContent() {
  const activeTab = document.querySelector('.tab[aria-selected="true"]')?.dataset.tab;
  if (activeTab === 'main') {
    renderMainHighlight(mainEls.highlight);
  }
  if (activeTab === 'company') renderCompanyHighlight(companyHighlightEl);
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

initHeroSearch();

// onAuthStateChange는 구독 시점에 현재 세션으로 즉시 한 번 발화한다(합성 이벤트). 그 최초 발화는
// 아래 시작 IIFE의 setActiveTab('main')이 이미 처리하므로 건너뛰어 renderMainHighlight 등이
// 페이지 로드마다 중복 실행되는 것을 막는다. 이후의 실제 로그인/로그아웃 이벤트는
// 정상적으로 refreshActiveTabContent를 호출한다.
let isInitialAuthEvent = true;
supabase.auth.onAuthStateChange((_event, session) => {
  renderAuthBar(session);
  if (isInitialAuthEvent) {
    isInitialAuthEvent = false;
    return;
  }
  refreshActiveTabContent();
});

(async () => {
  const session = await getSession();
  renderAuthBar(session);
  setActiveTab('main');
})();
