/* ============================================================================
 *  마몽어스 · 몰입 모드 (전체화면 + 가로 고정)
 *
 *  플랫폼별 현실:
 *   · 안드로이드(갤럭시) → Fullscreen API + Orientation Lock 모두 지원.
 *                          첫 터치 한 번이면 완전 자동으로 가로 전체화면.
 *   · 아이폰(사파리)     → 애플이 iPhone 에서 Fullscreen API 를 막아놨다.
 *                          (iPad 는 되는데 iPhone 만 차단) 방향 고정 API 도 전체화면이
 *                          전제라 같이 막힌다. → 홈화면 추가(PWA)만이 유일한 진짜 전체화면.
 *   · 카톡 인앱 브라우저 → WebView 라 둘 다 대부분 실패. 외부 브라우저 유도 필요.
 *
 *  ※ window.screen 을 가리지 않도록 이름은 Viewport 로 둔다.
 * ==========================================================================*/
const UA = navigator.userAgent || '';

const Viewport = {
  isIOS:      /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  isIPhone:   /iPhone|iPod/.test(UA) || (/iPad/.test(UA) === false && /Macintosh/.test(UA) && navigator.maxTouchPoints > 1),
  isAndroid:  /Android/.test(UA),
  isKakao:    /KAKAOTALK/i.test(UA),
  isInApp:    /KAKAOTALK|FBAN|FBAV|Instagram|Line\/|NAVER|DaumApps|; wv\)/i.test(UA),
  isTouch:    matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,

  armed: false,
  userExited: false,        // 사용자가 직접 전체화면을 껐으면 다시 강제하지 않는다
  lockOk: false,
  fsOk: false,

  get standalone() {
    return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches
        || matchMedia('(display-mode: fullscreen)').matches;
  },
  get isPortrait() { return innerHeight > innerWidth; },
  /** 폰처럼 좁은 화면인가 (PC 창을 세로로 줄인 경우는 제외) */
  get isPhone() { return this.isTouch && Math.min(innerWidth, innerHeight) < 620; },
  get inFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  /* ---------------- 진입 ---------------- */
  /** 응답이 없는 브라우저가 있어 무한 대기를 막는다.
   *  (전체화면 요청이 영영 안 끝나면 뒤따르는 방향 고정이 실행되지 못한다) */
  _timeout(p, ms) {
    return Promise.race([
      Promise.resolve(p).catch(() => false),
      new Promise(res => setTimeout(() => res(false), ms)),
    ]);
  },

  /** 반드시 사용자 제스처 안에서 호출할 것 (브라우저 정책) */
  async enter() {
    const el = document.documentElement;
    // 1) 전체화면
    try {
      if (this.inFullscreen) this.fsOk = true;
      else {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          await this._timeout(req.call(el, { navigationUI: 'hide' }), 1500);
          this.fsOk = this.inFullscreen;
        }
      }
    } catch { this.fsOk = false; }
    // 시도했는데 안 들어가진 경우만 실패로 센다 (지원 안 되는 브라우저에서 무한 재시도 방지)
    if (!this.fsOk && !this.isIPhone) {
      this._failCount++;
      if (this._failCount === 3 && this.isPhone && typeof UI !== 'undefined')
        UI.toast('이 브라우저는 전체화면을 막고 있습니다.<br>☰ 메뉴 → <b>전체화면 켜기</b>를 눌러보거나, 브라우저 메뉴의 <b>홈 화면에 추가</b>로 실행하면 주소창 없이 플레이됩니다.', 9000);
    }

    // 2) 방향 고정 — 전체화면 성패와 무관하게 반드시 시도한다
    try {
      if (screen.orientation && screen.orientation.lock) {
        await this._timeout(screen.orientation.lock('landscape'), 1500);
        this.lockOk = (screen.orientation.type || '').startsWith('landscape');
      }
    } catch { this.lockOk = false; }

    this.sync();
    return { fullscreen: this.fsOk, orientation: this.lockOk };
  },

  async exit() {
    this.userExited = true;
    try { screen.orientation?.unlock?.(); } catch {}
    try {
      if (this.inFullscreen) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch {}
    this.sync();
  },

  async toggle() {
    if (this.inFullscreen) await this.exit();
    else { this.userExited = false; await this.enter(); }
  },

  /* ---------------- 자동 진입 준비 ----------------
   * 브라우저는 "사용자 제스처 없이는" 전체화면을 허용하지 않는다.
   * 그래서 첫 터치/클릭 한 번에 즉시 진입하도록 걸어둔다 → 체감상 자동. */
  _fire: null,
  _EVTS: ['pointerdown', 'touchend', 'click'],

  disarm() {
    if (!this._fire) return;
    this._EVTS.forEach(e => document.removeEventListener(e, this._fire, true));
    this._fire = null; this.armed = false;
  },

  _failCount: 0,

  arm() {
    this.disarm();                       // 중복 등록 방지 (재무장 시 이전 리스너가 남으면 enter 가 두 번 돈다)
    this.armed = true;
    this._fire = (e) => {
      // 입력창을 누른 탭은 건너뛴다 — 키보드가 올라오며 전체화면을 도로 해제해버린다.
      // (첫 탭은 대부분 닉네임 칸이라, 여기서 발동하면 "전체화면이 안 된다"로 보인다)
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      this.disarm();                     // 먼저 해제해야 pointerdown→click 로 두 번 실행되지 않는다
      if (!this.userExited && this.isPhone) this.enter();
    };
    this._EVTS.forEach(e => document.addEventListener(e, this._fire, true));
  },

  /* ---------------- 회전 안내 오버레이 ----------------
   * 이 오버레이는 화면 전체를 덮는 차단막이다. resize/orientationchange 이벤트가
   * 오지 않는 브라우저(일부 인앱 WebView)에서 한 번 켜진 채 멈추면 게임을 아예 못 한다.
   * → 이벤트를 믿지 않고 짧은 주기로 직접 확인한다. 상태가 바뀔 때만 DOM 을 건드린다. */
  _lastNeed: null,
  _lastSize: '',

  sync() {
    const need = this.isPhone && this.isPortrait && !this.lockOk;
    const size = innerWidth + 'x' + innerHeight;

    if (need !== this._lastNeed) {
      this._lastNeed = need;
      const el = document.getElementById('rotate-gate');
      if (el) el.classList.toggle('hidden', !need);
    }
    if (size !== this._lastSize) {
      this._lastSize = size;
      if (typeof Render !== 'undefined') Render.resize?.();   // 캔버스 재계산
    }
    document.body.classList.toggle('immersive', this.inFullscreen);
  },

  init() {
    // 홈화면에 추가된 상태면 이미 전체화면 — 아무것도 할 필요가 없다
    if (!this.standalone) this.arm();

    ['fullscreenchange', 'webkitfullscreenchange'].forEach(e =>
      document.addEventListener(e, () => {
        if (!this.inFullscreen) {
          this.fsOk = false;
          // 키보드·뒤로 제스처·알림창이 전체화면을 풀어버린다 →
          // 다음 터치에 다시 들어가도록 재무장한다. (게임 중이면 조이스틱 첫 터치가 곧 재진입)
          // 이게 없으면 한 번 풀린 뒤 세션 내내 주소창이 떠 있게 된다.
          if (!this.userExited && this.isPhone && this._failCount < 3) this.arm();
        } else this._failCount = 0;
        this.sync();
      }));
    ['resize', 'orientationchange'].forEach(e =>
      window.addEventListener(e, () => setTimeout(() => this.sync(), 120)));
    try { screen.orientation?.addEventListener?.('change', () => setTimeout(() => this.sync(), 120)); } catch {}
    try { matchMedia('(orientation: portrait)').addEventListener('change', () => setTimeout(() => this.sync(), 120)); } catch {}
    // 최후의 안전망 — 이벤트가 하나도 안 오는 환경에서도 게이트가 걸리지 않게
    setInterval(() => this.sync(), 400);

    // 백그라운드 다녀오면 전체화면이 풀리는 기기가 있다 → 다음 터치에 복구
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.userExited && this.isPhone && !this.inFullscreen) {
        this.arm();
      }
    });

    this.injectManifest();
    this.sync();
  },

  /* ---------------- PWA 매니페스트 (파일 하나 유지를 위해 런타임 생성) ----------------
   * 안드로이드에서 '홈 화면에 추가' 시 display:fullscreen + orientation:landscape 로
   * 설치되어, 아이콘으로 실행하면 주소창 없이 바로 가로 전체화면이 된다. */
  injectManifest() {
    try {
      const icon = this.makeIcon(512);
      const manifest = {
        name: '마몽어스', short_name: '마몽어스',
        description: '링크 하나로 하는 양들의 마피아',
        display: 'fullscreen', orientation: 'landscape',
        background_color: '#050810', theme_color: '#050810',
        start_url: location.pathname + location.search,
        scope: location.pathname,
        icons: [
          { src: icon, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: icon, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
      const link = document.createElement('link');
      link.rel = 'manifest'; link.href = url;
      document.head.appendChild(link);

      // iOS 홈화면 아이콘
      const ai = document.createElement('link');
      ai.rel = 'apple-touch-icon'; ai.href = icon;
      document.head.appendChild(ai);
    } catch {}
  },

  makeIcon(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#0b1224'; g.fillRect(0, 0, size, size);
    const grad = g.createRadialGradient(size * .5, size * .38, size * .05, size * .5, size * .5, size * .62);
    grad.addColorStop(0, '#1b2c4e'); grad.addColorStop(1, '#070c18');
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    g.font = `${Math.round(size * 0.58)}px "Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🐑', size / 2, size * 0.54);
    return c.toDataURL('image/png');
  },

  /* ---------------- 아이폰 안내 ----------------
   * 애플 제약상 사파리에서는 전체화면 API 자체가 없다.
   * 홈화면 추가가 유일한 방법이라 1회만, 닫으면 다시 안 뜨게 안내한다. */
  shouldHintIOS() {
    return this.isIPhone && !this.standalone && !this.isInApp
        && !localStorage.getItem('duckus_ios_hint');
  },
  dismissIOSHint() { try { localStorage.setItem('duckus_ios_hint', '1'); } catch {} },

  /** 카톡 인앱은 전체화면·방향고정이 모두 막혀 있다 */
  shouldHintInApp() {
    return this.isInApp && !localStorage.getItem('duckus_inapp_hint');
  },
  dismissInAppHint() { try { localStorage.setItem('duckus_inapp_hint', '1'); } catch {} },
};
