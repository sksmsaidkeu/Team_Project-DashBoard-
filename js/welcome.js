/**
 * 회원가입/로그인 완료 후 보여주는 확인(환영) 모달.
 * DESIGN.md 1.1절 톤 원칙: 구직자는 격려체, 기업은 사무 존댓말.
 */

const COPY = {
  COMPANY: {
    signup: {
      title: '환영합니다, 기업 회원님',
      body: '이제 조건에 맞는 인재를 검색하고 채용 공고를 등록할 수 있습니다.',
      cta: '기업 화면으로 이동',
    },
    login: {
      title: '다시 오셨네요',
      body: '기업 화면에서 인재 검색과 공고 관리를 이어서 진행하세요.',
      cta: '기업 화면으로 이동',
    },
  },
  JOBSEEKER: {
    signup: {
      title: '환영해요, 구직자님',
      body: '지금부터 맞춤 공고를 추천받고 관심 있는 기업에 지원할 수 있어요.',
      cta: '구직자 화면으로 이동',
    },
    login: {
      title: '다시 오셨네요',
      body: '구직자 화면에서 맞춤 공고와 지원 현황을 이어서 확인하세요.',
      cta: '구직자 화면으로 이동',
    },
  },
  DEFAULT: {
    signup: { title: '환영합니다', body: '가입이 완료되었습니다.', cta: '시작하기' },
    login: { title: '다시 오셨네요', body: '로그인되었습니다.', cta: '계속하기' },
  },
};

let overlayEl = null;
let continueBtn = null;
let onContinueCallback = null;
let inertedEls = [];

/**
 * 모달이 열려 있는 동안 배경(헤더/메인 콘텐츠 등 모달이 아닌 body의 최상위 형제 요소)에
 * inert를 설정해 스크린리더/키보드 포커스가 배경으로 새지 않게 막는다.
 */
function setBackgroundInert(isInert) {
  if (isInert) {
    inertedEls = Array.from(document.body.children).filter((el) => el !== overlayEl);
    inertedEls.forEach((el) => {
      el.inert = true;
    });
  } else {
    inertedEls.forEach((el) => {
      el.inert = false;
    });
    inertedEls = [];
  }
}

function close() {
  if (!overlayEl) return;
  overlayEl.hidden = true;
  document.body.classList.remove('modal-open');
  setBackgroundInert(false);
  const callback = onContinueCallback;
  onContinueCallback = null;
  callback?.();
}

function ensureModal() {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'welcome-modal';
  overlayEl.className = 'modal-overlay';
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="welcome-modal-title">
      <h2 class="text-h2" id="welcome-modal-title"></h2>
      <p class="page-lead" id="welcome-modal-body"></p>
      <div class="form-actions">
        <button type="button" class="btn btn-primary" id="welcome-modal-continue"></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  continueBtn = overlayEl.querySelector('#welcome-modal-continue');
  continueBtn.addEventListener('click', close);

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) close();
  });

  document.addEventListener('keydown', (e) => {
    if (!overlayEl || overlayEl.hidden) return;

    if (e.key === 'Escape') {
      close();
      return;
    }

    // Focus trap: 모달 안의 포커스 가능한 요소(현재는 continueBtn 하나)만 순환시킨다.
    // 요소가 하나뿐이므로 Tab/Shift+Tab 모두 그 버튼에 머무르도록 기본 동작을 막는다.
    if (e.key === 'Tab') {
      e.preventDefault();
      continueBtn.focus();
    }
  });
}

/**
 * @param {Object} opts
 * @param {'COMPANY'|'JOBSEEKER'|null} opts.role
 * @param {'signup'|'login'} opts.mode
 * @param {() => void} [opts.onContinue] - 모달을 닫을 때(버튼 클릭/배경 클릭/Esc) 호출된다.
 */
export function showWelcomeModal({ role, mode, onContinue }) {
  ensureModal();

  const roleCopy = COPY[role] || COPY.DEFAULT;
  const copy = roleCopy[mode] || COPY.DEFAULT[mode] || COPY.DEFAULT.login;

  overlayEl.querySelector('#welcome-modal-title').textContent = copy.title;
  overlayEl.querySelector('#welcome-modal-body').textContent = copy.body;
  continueBtn.textContent = copy.cta;

  onContinueCallback = onContinue;
  overlayEl.hidden = false;
  document.body.classList.add('modal-open');
  setBackgroundInert(true);
  continueBtn.focus();
}
