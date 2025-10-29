const rootStyle = document.documentElement.style;
const nav = document.querySelector('.primary-nav');
const panelOk = document.querySelector('.panel-ok');
const activePrimary = document.body.dataset.primary;
const hideNav = document.body.dataset.hideNav === 'true';

let navLabelFitFrame = 0;

function fitPrimaryNavLabels() {
  if (!nav) {
    return;
  }
  const items = nav.querySelectorAll('.primary-nav__item');
  const minFontSize = 10;
  items.forEach((item) => {
    const label = item.querySelector('.primary-nav__label');
    if (!label) {
      return;
    }
    label.style.fontSize = '';
    const itemStyles = window.getComputedStyle(item);
    const maxWidth =
      item.clientWidth -
      (parseFloat(itemStyles.paddingLeft || '0') + parseFloat(itemStyles.paddingRight || '0'));
    if (maxWidth <= 0) {
      return;
    }
    const computed = window.getComputedStyle(label);
    let fontSize = parseFloat(computed.fontSize) || 12;
    label.style.fontSize = `${fontSize}px`;
    let guard = 0;
    while (label.scrollWidth > maxWidth && fontSize > minFontSize && guard < 24) {
      fontSize -= 0.5;
      label.style.fontSize = `${fontSize}px`;
      guard += 1;
    }
  });
}

function scheduleNavLabelFit() {
  if (!nav) {
    return;
  }
  cancelAnimationFrame(navLabelFitFrame);
  navLabelFitFrame = window.requestAnimationFrame(fitPrimaryNavLabels);
}

if (nav && nav.parentElement !== document.body) {
  document.body.appendChild(nav);
}

if (panelOk && panelOk.parentElement !== document.body) {
  document.body.appendChild(panelOk);
}

if (nav) {
  if (hideNav) {
    nav.classList.add('primary-nav--hidden');
  }
  const items = nav.querySelectorAll('.primary-nav__item');
  items.forEach((item) => {
    const isActive = item.dataset.primary === activePrimary;
    item.classList.toggle('primary-nav__item--active', isActive);
    if (isActive) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
  scheduleNavLabelFit();
} else if (panelOk) {
  rootStyle.setProperty('--nav-height', `${panelOk.offsetHeight || 0}px`);
} else {
  rootStyle.setProperty('--nav-height', '0px');
}

document.querySelectorAll('.panel-ok__button').forEach((button) => {
  button.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else if (document.referrer) {
      window.location.href = document.referrer;
    } else {
      window.location.href = 'index.html';
    }
  });
});

function updateNavMetrics() {
  if (nav && !nav.classList.contains('primary-nav--hidden')) {
    rootStyle.setProperty('--nav-height', `${nav.offsetHeight}px`);
    const navRect = nav.getBoundingClientRect();
    console.info(
      `[Navigation] position: top=${Math.round(navRect.top)}px; bottom=${Math.round(
        navRect.bottom
      )}px`
    );
    const primaryScreen = document.querySelector('.screen--primary');
    if (primaryScreen) {
      const screenRect = primaryScreen.getBoundingClientRect();
      console.info(
        `[Screen] scrollTop=${Math.round(primaryScreen.scrollTop)}; top=${Math.round(
          screenRect.top
        )}px; bottom=${Math.round(screenRect.bottom)}px`
      );
    }
    scheduleNavLabelFit();
    return;
  }

  if (panelOk) {
    rootStyle.setProperty('--nav-height', `${panelOk.offsetHeight}px`);
    const panelRect = panelOk.getBoundingClientRect();
    console.info(
      `[PanelOK] position: top=${Math.round(panelRect.top)}px; bottom=${Math.round(
        panelRect.bottom
      )}px`
    );
    return;
  }

  rootStyle.setProperty('--nav-height', '0px');
}

updateNavMetrics();

const toastEl = document.getElementById('toast');
let toastTimer;

export function showToast(message, duration = 2800) {
  if (!toastEl) {
    console.log('[Toast]', message);
    return;
  }
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, duration);
}

window.showToast = showToast;

const lockedModal = document.getElementById('locked-modal');
let lockRedirect = null;

function openLockedModal(destination) {
  lockRedirect = destination || null;
  if (lockedModal && typeof lockedModal.showModal === 'function') {
    lockedModal.returnValue = 'cancel';
    lockedModal.showModal();
  } else {
    const proceed = window.confirm('Глава заблокирована. Хотите открыть магазин?');
    if (proceed && destination) {
      window.location.href = destination;
    }
  }
}

if (lockedModal) {
  lockedModal.addEventListener('close', () => {
    if (lockedModal.returnValue === 'store' && lockRedirect) {
      window.location.href = lockRedirect;
    }
    lockRedirect = null;
  });
}

document.querySelectorAll('[data-locked="true"]').forEach((element) => {
  element.addEventListener('click', (event) => {
    event.preventDefault();
    openLockedModal(element.dataset.lockDestination);
  });
});

const fileInput = document.getElementById('file-input');
if (fileInput) {
  document.querySelectorAll('[data-action="import-book"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      fileInput.click();
    });
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      showToast(`Загружен файл ${fileInput.files[0].name}`);
    }
  });
}

document.getElementById('my-profile-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  showToast('Профиль сохранён');
});

const soundToggle = document.getElementById('toggle-sound');
if (soundToggle) {
  soundToggle.addEventListener('change', () => {
    showToast(soundToggle.checked ? 'Звук включён' : 'Звук выключен');
  });
}

const musicToggle = document.getElementById('toggle-music');
if (musicToggle) {
  musicToggle.addEventListener('change', () => {
    showToast(musicToggle.checked ? 'Музыка включена' : 'Музыка выключена');
  });
}

const ivyVoiceToggle = document.getElementById('toggle-ivy-voice');
if (ivyVoiceToggle) {
  ivyVoiceToggle.addEventListener('change', () => {
    showToast(ivyVoiceToggle.checked ? 'Озвучивание Айви включено' : 'Озвучивание Айви выключено');
  });
}

function handleShare() {
  const shareData = {
    title: 'Mask 2077',
    text: 'Оцени, какая книга: https://aigpt.app/tts_test/',
    url: 'https://aigpt.app/tts_test/',
  };

  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard
      .writeText(`${shareData.text} ${shareData.url}`)
      .then(() => showToast('Ссылка скопирована в буфер обмена'))
      .catch(() => showToast('Не удалось скопировать ссылку'));
  } else {
    showToast('Поделиться можно через https://aigpt.app/tts_test/');
  }
}

document.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) {
    return;
  }
  const action = actionTarget.dataset.action;
  switch (action) {
    case 'buy-premium':
      event.preventDefault();
      showToast('Премиум пропуск оформлен!');
      break;
    case 'buy-offer':
      event.preventDefault();
      showToast('Предложение добавлено в корзину');
      break;
    case 'share-app':
      event.preventDefault();
      handleShare();
      break;
    case 'rate-app':
      event.preventDefault();
      window.open('https://play.google.com/store/apps/details?id=mask2077', '_blank', 'noopener');
      showToast('Спасибо за оценку!');
      break;
    case 'report-issue':
      event.preventDefault();
      window.location.href = 'mailto:mask.usa@gmail.com?subject=Mask2077%20feedback';
      break;
    case 'import-book':
      event.preventDefault();
      fileInput?.click();
      break;
    default:
      break;
  }
});

function measureCssSafeAreaInsets() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position: fixed; top: 0; left: 0; width: 0; height: 0; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); pointer-events: none; opacity: 0;';
  document.body.appendChild(probe);
  const styles = window.getComputedStyle(probe);
  const top = parseFloat(styles.paddingTop) || 0;
  const bottom = parseFloat(styles.paddingBottom) || 0;
  const left = parseFloat(styles.paddingLeft) || 0;
  const right = parseFloat(styles.paddingRight) || 0;
  probe.remove();
  return { top, bottom, left, right, source: 'css' };
}

async function getNativeSafeAreaInsets() {
  const candidates = [
    () => window.Mask2077Native?.getSafeAreaInsets?.(),
    () => window.Mask2077Bridge?.getSafeAreaInsets?.(),
    () => window.NativeUtilities?.getSafeAreaInsets?.(),
    () => window.Capacitor?.Plugins?.NativeUtilities?.getSafeAreaInsets?.(),
  ];

  for (const resolver of candidates) {
    try {
      const result = await resolver()?.catch(() => null);
      if (result && (typeof result.top === 'number' || typeof result.bottom === 'number')) {
        return {
          top: result.top ?? 0,
          bottom: result.bottom ?? 0,
          left: result.left ?? 0,
          right: result.right ?? 0,
          source: 'native',
        };
      }
    } catch (error) {
      console.warn('[SafeArea] native bridge error', error);
    }
  }

  return null;
}

function applySafeAreaInsets(top, bottom, left, right) {
  rootStyle.setProperty('--safe-inset-top', `${top}px`);
  rootStyle.setProperty('--safe-inset-bottom', `${bottom}px`);
  rootStyle.setProperty('--safe-inset-left', `${left}px`);
  rootStyle.setProperty('--safe-inset-right', `${right}px`);
  const bodyStyle = document.body.style;
  bodyStyle.paddingTop = `${top}px`;
  bodyStyle.paddingRight = `${right}px`;
  bodyStyle.paddingBottom = `${bottom}px`;
  bodyStyle.paddingLeft = `${left}px`;
}

let safeAreaInFlight = false;
let safeAreaUpdateTimer = 0;

async function initSafeArea() {
  if (safeAreaInFlight) {
    return;
  }
  safeAreaInFlight = true;
  try {
    const nativeInsets = await getNativeSafeAreaInsets();
    const cssInsets = measureCssSafeAreaInsets();
    const top = nativeInsets?.top ?? cssInsets.top;
    const bottom = nativeInsets?.bottom ?? cssInsets.bottom;
    const left = nativeInsets?.left ?? cssInsets.left;
    const right = nativeInsets?.right ?? cssInsets.right;
    applySafeAreaInsets(top, bottom, left, right);
    const notchDetected = top > 0.5;
    const source = nativeInsets?.source ?? cssInsets.source;
    const bodyStyles = window.getComputedStyle(document.body);
    console.info(
      `[SafeArea] body[data-primary='${document.body.dataset.primary}'] paddings: top=${bodyStyles.paddingTop}; right=${bodyStyles.paddingRight}; bottom=${bodyStyles.paddingBottom}; left=${bodyStyles.paddingLeft}`
    );
    console.info(
      `[SafeArea] notchDetected=${notchDetected}; source=${source}; top=${top}px; bottom=${bottom}px; left=${left}px; right=${right}px`
    );
    updateNavMetrics();
    if (nav && !nav.classList.contains('primary-nav--hidden')) {
      console.info(`[Navigation] height=${nav.offsetHeight}px`);
      const activeItem = nav.querySelector('.primary-nav__item--active');
      if (activeItem) {
        const rect = activeItem.getBoundingClientRect();
        console.info(
          `[Navigation] active data-primary=${activeItem.dataset.primary}; top=${Math.round(rect.top)}px; bottom=${Math.round(rect.bottom)}px`
        );
      }
    } else if (panelOk) {
      console.info(`[PanelOK] height=${panelOk.offsetHeight}px`);
    }
  } finally {
    safeAreaInFlight = false;
  }
}

function scheduleSafeAreaUpdate(delay = 0) {
  clearTimeout(safeAreaUpdateTimer);
  safeAreaUpdateTimer = window.setTimeout(() => {
    initSafeArea().catch((error) => console.warn('[SafeArea] update failed', error));
  }, delay);
}

window.addEventListener('load', () => {
  scheduleSafeAreaUpdate();
  scheduleNavLabelFit();
});

if (document.fonts && typeof document.fonts.ready?.then === 'function') {
  document.fonts.ready.then(() => {
    scheduleNavLabelFit();
  });
}

window.addEventListener('resize', () => {
  updateNavMetrics();
  scheduleNavLabelFit();
  scheduleSafeAreaUpdate(150);
});
