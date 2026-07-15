import { supabase } from './supabaseClient.js';
import { getSession, getCurrentUserProfile, loginWithPassword, logout } from './auth.js';
import { initSignup } from './signup.js';
import { renderCompanyHighlight } from './tab-company.js';
import { renderJobseekerDashboard } from './jobseeker-dashboard.js';

const tabButtons = document.querySelectorAll('.tab');
const panels = {
  main: document.getElementById('panel-main'),
  company: document.getElementById('panel-company'),
  jobseeker: document.getElementById('panel-jobseeker'),
  signup: document.getElementById('panel-signup'),
};
const authBar = document.getElementById('auth-bar');
const companyHighlightEl = document.getElementById('company-highlight');

function setActiveTab(tabName) {
  tabButtons.forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tabName));
  });

  Object.entries(panels).forEach(([name, el]) => {
    if (!el) return;
    el.hidden = name !== tabName;
  });

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

document.getElementById('signup-entry-btn')?.addEventListener('click', () => setActiveTab('signup'));

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
    });
    return;
  }

  authBar.innerHTML = `
    <span class="auth-user">${session.user.email}</span>
    <button type="button" class="btn btn-ghost" id="logout-btn">로그아웃</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', () => logout());
}

function refreshActiveTabContent() {
  const activeTab = document.querySelector('.tab[aria-selected="true"]')?.dataset.tab;
  if (activeTab === 'company') renderCompanyHighlight(companyHighlightEl);
  if (activeTab === 'jobseeker') renderJobseekerDashboard();
}

initSignup({
  onSuccess: (userType) => {
    setActiveTab(userType === 'COMPANY' ? 'company' : 'jobseeker');
  },
});

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
