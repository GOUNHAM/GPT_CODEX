import { request } from 'playwright';
import { createHash } from 'node:crypto';
import { searchStandard } from './sono-rooms.js';

const ORIGIN = 'https://www.sonohotelsresorts.com';
const LOGIN = '/management/auth/login';
const USER_INFO = '/management/auth/userinfo';
const MEMBERSHIPS = '/management/member/reserve/memberNoList';
const ALL_MEMBERSHIPS = '/management/member/reserve/totalMemberNoList';
const READ_PATHS = new Set([USER_INFO, MEMBERSHIPS, ALL_MEMBERSHIPS, '/memberReservation/room/placeList', '/management/room/detail']);
const READ_POST_PATHS = new Set(['/memberReservation/room/list/pc', '/memberReservation/room/detail', '/memberReservation/room/detail/price', '/management/room/reserveRoomInfoList']);
const SESSION_TTL = 15 * 60_000;
const MEMBERSHIP_TTL = 60_000;
const MEMBER_ACTION = '소노 공식 사이트에서 회사 회원권이 연결되어 있는지 확인해 주세요. 별도 법인 예약 경로를 사용한다면 그 경로로 연동해야 합니다.';

export class SonoError extends Error {
  constructor(code, message, status = 503, connection) {
    super(message);
    this.code = code;
    this.status = status;
    this.connection = connection;
  }
}

// Fixed official origin and explicit read-only endpoints. Cookies remain in memory.
// No browser, storage-state file, profile, credential logging, booking or payment API.
export class SonoClient {
  constructor({ env = process.env, createContext = options => request.newContext(options), now = () => Date.now() } = {}) {
    this.env = env;
    this.createContext = createContext;
    this.now = now;
    this.context = null;
    this.sessionUntil = 0;
    this.checkedAt = 0;
    this.connection = null;
    this.pending = null;
    this.credentialKey = null;
    this.standardMember = null;
    this.roomPending = null;
    this.failure = null;
    this.failureUntil = 0;
  }

  configured() { return Boolean(this.env.SONO_USERNAME && this.env.SONO_PASSWORD); }

  status() {
    const fresh = this.connection && this.sessionUntil > this.now() && this.checkedAt + MEMBERSHIP_TTL > this.now();
    return fresh ? { configured: this.configured(), ...this.connection } : { configured: this.configured(), authenticated: false, state: 'unchecked', membershipCount: null };
  }

  async dispose() {
    if (this.context) await this.context.dispose().catch(() => {});
    this.context = null;
    this.sessionUntil = 0;
    this.connection = null;
    this.checkedAt = 0;
    this.standardMember = null;
  }

  async call(path, data, params = {}) {
    if (!((READ_PATHS.has(path) || /^\/management\/member\/reserve\/userTypeList\/[^/]+$/.test(path)) && data === undefined) && !((path === LOGIN || READ_POST_PATHS.has(path)) && data !== undefined)) {
      throw new SonoError('READ_ONLY', '허용된 로그인 및 읽기 전용 조회만 사용할 수 있습니다.');
    }
    let response;
    const route = `/api/hms/user${path}?${new URLSearchParams({lang:'ko',deviceType:'PC',mobileAppYn:'N',...params})}`;
    try {
      response = data === undefined ? await this.context.get(route, { maxRedirects: 0 }) : await this.context.post(route, { data, maxRedirects: 0 });
    } catch {
      throw new SonoError('SONO_UNREACHABLE', '소노 사이트에 연결하지 못했습니다. 네트워크 연결을 확인한 후 다시 시도해 주세요.');
    }
    if (response.status() === 401) {
      await this.dispose();
      if (path === LOGIN) throw new SonoError('SONO_AUTH_FAILED', '소노 로그인에 실패했습니다. 공식 사이트에서 계정 정보를 확인해 주세요.', 409);
      throw new SonoError('SONO_SESSION_EXPIRED', '소노 로그인 세션이 만료되었습니다. 연결 확인을 눌러 다시 로그인해 주세요.', 409);
    }
    if (!response.ok()) throw new SonoError('SONO_HTTP_ERROR', '소노 사이트가 조회 요청을 처리하지 못했습니다. 잠시 후 다시 확인해 주세요.');
    let result;
    try { result = await response.json(); } catch { throw new SonoError('SONO_INVALID_RESPONSE', '소노 사이트 응답 형식이 변경되었습니다. 연동 점검이 필요합니다.'); } finally { await response.dispose(); }
    if (result?.success !== true) {
      if (path === LOGIN) throw new SonoError('SONO_AUTH_FAILED', '소노 로그인에 실패했습니다. 공식 사이트에서 계정 정보를 확인해 주세요.', 409);
      throw new SonoError('SONO_API_ERROR', '소노 사이트에서 조회를 완료하지 못했습니다. 빈방 없음으로 판단할 수 없습니다.');
    }
    return result.body;
  }

  checkConnection() {
    // One login request for concurrent visitors; no repeated failures against the account.
    if (!this.pending) this.pending = this.check().finally(() => { this.pending = null; });
    return this.pending;
  }

  async check() {
    if (!this.configured()) throw new SonoError('SONO_CREDENTIALS_MISSING', '서버에 소노 로그인 정보가 설정되지 않았습니다. 관리자에게 계정 설정을 요청해 주세요.');
    const fingerprint = createHash('sha256').update(this.env.SONO_USERNAME).update('\0').update(this.env.SONO_PASSWORD).digest('hex');
    if (this.credentialKey !== fingerprint) {
      await this.dispose();
      this.credentialKey = fingerprint;
      this.failure = null;
      this.failureUntil = 0;
    }
    if (this.failure && this.failureUntil > this.now()) throw this.failure;
    const cached = this.status();
    if (cached.state !== 'unchecked') return cached;
    try {
      if (!this.context || this.sessionUntil <= this.now()) {
        await this.dispose();
        this.context = await this.createContext({
          baseURL: ORIGIN,
          ...(this.env.HTTPS_PROXY || this.env.HTTP_PROXY ? { proxy: { server: this.env.HTTPS_PROXY || this.env.HTTP_PROXY } } : {}),
          extraHTTPHeaders: { Accept: 'application/json', Referer: `${ORIGIN}/member/login` },
          timeout: 30_000,
          // TLS verification stays enabled. Use the environment's CA trust.
          ignoreHTTPSErrors: false,
        });
        const bootstrap = await this.context.get('/member/login', { maxRedirects: 0 });
        const bootstrapOk = bootstrap.ok();
        await bootstrap.dispose();
        if (!bootstrapOk) throw new SonoError('SONO_UNREACHABLE', '소노 로그인 페이지에 연결하지 못했습니다.');
        const login = await this.call(LOGIN, { userId: this.env.SONO_USERNAME, password: this.env.SONO_PASSWORD, rememberMe: false });
        if (login?.lock) throw new SonoError('SONO_ACCOUNT_LOCKED', '소노 계정의 로그인이 일시적으로 제한되어 있습니다. 공식 사이트에서 계정 상태를 확인해 주세요.', 409);
        if (!login?.userInfo || typeof login.userInfo !== 'object') {
          if (login?.alreadyLogin) throw new SonoError('SONO_EXISTING_LOGIN', '소노 사이트가 기존 로그인 확인을 요청했습니다. 공식 사이트에서 로그인 상태를 확인해 주세요.', 409);
          throw new SonoError('SONO_AUTH_FAILED', '소노 로그인에 실패했습니다. 공식 사이트에서 아이디와 비밀번호를 확인해 주세요. 반복 시도는 잠시 중단됩니다.', 409);
        }
        if (login.userInfo.needPwdChangeYn === 'Y' || login.userInfo.needNumChangeYn === 'Y') throw new SonoError('SONO_ACCOUNT_ACTION_REQUIRED', '소노 사이트에서 비밀번호 또는 회원 확인번호 변경을 요청했습니다. 공식 사이트에서 먼저 완료해 주세요.', 409);
        const verified = await this.call(USER_INFO);
        if (!verified?.userInfo || typeof verified.userInfo !== 'object') throw new SonoError('SONO_AUTH_FAILED', '소노 로그인 세션을 확인하지 못했습니다.', 409);
        this.sessionUntil = this.now() + SESSION_TTL;
      }
      const memberships = await this.call(MEMBERSHIPS);
      if (!Array.isArray(memberships)) throw new SonoError('SONO_INVALID_RESPONSE', '소노 회원권 목록의 응답 형식이 변경되었습니다.');
      const all = await this.call(ALL_MEMBERSHIPS);
      if (!Array.isArray(all)) throw new SonoError('SONO_INVALID_RESPONSE', '전체 회원번호 목록을 확인하지 못했습니다.');
      const standard = all.filter(m => m.memIndNm === 'D멤버스' && typeof m.memNo === 'string' && m.memNo);
      this.standardMember = standard.length === 1 ? standard[0].memNo : null;
      this.checkedAt = this.now();
      this.connection = {
        authenticated: true,
        state: memberships.length ? 'membership_found' : this.standardMember ? 'general_only' : 'membership_missing',
        standardAvailable: Boolean(this.standardMember),
        totalMembershipCount: all.length,
        membershipCount: memberships.length,
        checkedAt: new Date(this.checkedAt).toISOString(),
        message: this.standardMember && !memberships.length ? 'D멤버스 일반 예약 조회를 이용할 수 있습니다. 회사 계약용 회원권은 0개로 조회됩니다.' : memberships.length ? '소노 로그인과 예약용 회원권 조회를 확인했습니다. 객실 조회 연동은 아직 검증되지 않았습니다.' : '소노 로그인은 정상입니다. 이 계정의 예약용 회원권이 0개로 조회되어 회사 콘도 재고를 확인할 수 없습니다.',
        action: this.standardMember && !memberships.length ? '일반 조회를 선택하면 실제 객실과 요금을 확인할 수 있습니다. 회사 예약 자격과는 다릅니다.' : memberships.length ? '회원권별 예약 조건과 회사 예약 경로 확인이 필요합니다.' : MEMBER_ACTION,
        roomSearchReady: Boolean(this.standardMember),
      };
      return this.status();
    } catch (cause) {
      const error = cause instanceof SonoError ? cause : new SonoError('SONO_UNREACHABLE', '소노 사이트 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      await this.dispose();
      this.failure = error;
      this.failureUntil = this.now() + (['SONO_AUTH_FAILED', 'SONO_ACCOUNT_LOCKED', 'SONO_ACCOUNT_ACTION_REQUIRED', 'SONO_EXISTING_LOGIN'].includes(error.code) ? 30 * 60_000 : 30_000);
      throw error;
    }
  }

  async search(criteria = {}) {
    if (this.roomPending) throw new SonoError('SONO_SEARCH_BUSY', '다른 객실 조회가 진행 중입니다. 잠시 후 다시 시도해 주세요.', 409);
    const task = this.runSearch(criteria);
    this.roomPending = task;
    try { return await task; } finally { this.roomPending = null; }
  }

  async runSearch(criteria) {
    const connection = await this.checkConnection();
    if (criteria.bookingBasis === 'standard') {
      if (!this.standardMember) throw new SonoError('SONO_STANDARD_UNAVAILABLE', '이 계정의 D멤버스 일반 예약 자격을 확인하지 못했습니다.', 409, connection);
      return { ...await searchStandard(this, criteria, this.standardMember, SonoError), connection };
    }
    if (!connection.membershipCount) throw new SonoError('SONO_MEMBERSHIP_MISSING', `${connection.message} ${MEMBER_ACTION}`, 409, connection);
    // Do not fabricate memberNo/userIndCd or use public prices as corporate availability.
    throw new SonoError('SONO_SEARCH_NOT_VERIFIED', '예약용 회원권은 확인되었습니다. 회사 회원권별 예약 경로와 조회 응답을 검증한 후 객실 조회를 사용할 수 있습니다.', 409, connection);
  }
}

export const sonoClient = new SonoClient();
