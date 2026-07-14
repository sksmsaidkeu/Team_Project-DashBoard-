import { supabase } from './supabaseClient.js';
import { getSession, getCurrentUserProfile, loginWithPassword, logout } from './auth.js';
import { initSignup } from './signup.js';
import { showWelcomeModal } from './welcome.js';
import { renderCompanyHighlight } from './tab-company.js';
import { renderJobseekerHighlight } from './tab-jobseeker.js';
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

const tabButtons = document.querySelectorAll('.tab');
const panels = {
  main: document.getElementById('panel-main'),
  company: document.getElementById('panel-company'),
  jobseeker: document.getElementById('panel-jobseeker'),
  signup: document.getElementById('panel-signup'),
};
const authBar = document.getElementById('auth-bar');

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    renderMainHighlight(document.getElementById('main-highlight-carousel'));
    renderRecentJobs(document.getElementById('main-recent-jobs'));
    renderRecentTalent(document.getElementById('main-recent-talent'));
    renderJobNews(document.getElementById('main-news'));
    renderMainTrend(document.getElementById('main-trend'));
    renderWantedTrend(document.getElementById('main-wanted-trend'));
    renderSkillRanking(document.getElementById('main-skill-ranking'));
    renderSkillCombo(document.getElementById('main-skill-combo'));
  }
  if (tabName === 'company') {
    renderCompanyHighlight(document.getElementById('company-highlight'));
  }
  if (tabName === 'jobseeker') {
    renderJobseekerHighlight(document.getElementById('jobseeker-highlight'));
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
        onContinue: () => setActiveTab(role === 'COMPANY' ? 'company' : role === 'JOBSEEKER' ? 'jobseeker' : 'main'),
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
    renderMainHighlight(document.getElementById('main-highlight-carousel'));
  }
  if (activeTab === 'company') renderCompanyHighlight(document.getElementById('company-highlight'));
  if (activeTab === 'jobseeker') renderJobseekerHighlight(document.getElementById('jobseeker-highlight'));
}

initSignup({
  onSuccess: (userType) => {
    showWelcomeModal({
      role: userType,
      mode: 'signup',
      onContinue: () => setActiveTab(userType === 'COMPANY' ? 'company' : 'jobseeker'),
    });
  },
});

initHeroSearch();

supabase.auth.onAuthStateChange((_event, session) => {
  renderAuthBar(session);
  refreshActiveTabContent();
});

(async () => {
  const session = await getSession();
  renderAuthBar(session);
  setActiveTab('main');
})();
