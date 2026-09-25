import { EasterEggGateway, MAX_TEXT, EVENTS_PER_SECOND } from './easter-egg.gateway';

jest.mock('../auth/verify-access-token', () => ({
  authenticateSocket: jest.fn(async (cookie?: string) => {
    if (cookie === 'access_token=admin') return { id: 'a1', username: 'admin', fullName: 'Ada', role: 'ADMIN' };
    if (cookie === 'access_token=admin2') return { id: 'a2', username: 'admin2', fullName: null, role: 'ADMIN' };
    if (cookie === 'access_token=user') return { id: 'u1', username: 'tl', fullName: 'Tim', role: 'TEAM_LEAD' };
    return null;
  }),
}));

let seq = 0;
function sock(cookie?: string) {
  return {
    id: `s${++seq}`,
    data: {} as any,
    handshake: { headers: { cookie } },
    emit: jest.fn(),
    join: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

describe('EasterEggGateway', () => {
  let gw: EasterEggGateway;
  let adminEmit: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    gw = new EasterEggGateway({} as any, {} as any, {} as any);
    adminEmit = jest.fn();
    gw.server = { to: jest.fn(() => ({ emit: adminEmit })) } as any;
  });
  afterEach(() => jest.useRealTimers());

  async function connect(s: any) {
    await gw.authenticate(s);
    gw.handleConnection(s);
  }

  async function setup() {
    const admin = sock('access_token=admin');
    const user = sock('access_token=user');
    await connect(admin);
    await connect(user);
    gw.join(user, { stage: 'terminal', max: 40 });
    return { admin, user };
  }

  it('disconnects sockets that fail authentication', async () => {
    const s = sock();
    await connect(s);
    expect(s.disconnect).toHaveBeenCalledWith(true);
    gw.join(s, {});
    gw.list(s);
    expect(s.emit).not.toHaveBeenCalled();
  });

  it('lists sessions to admins without any terminal content', async () => {
    const { admin, user } = await setup();
    gw.status(user, { attempts: 3 });
    gw.list(admin);
    const payload = admin.emit.mock.calls[0][1];
    expect(payload.sessions).toEqual([
      expect.objectContaining({ id: user.id, name: 'Tim', role: 'TEAM_LEAD', stage: 'terminal', attempts: 3, max: 40, admin: null, mode: 'AUTO' }),
    ]);
    expect(Object.keys(payload.sessions[0]).sort()).toEqual(['admin', 'attempts', 'id', 'lastActive', 'max', 'mode', 'name', 'role', 'stage']);
    jest.advanceTimersByTime(600);
    expect(gw.server.to).toHaveBeenCalledWith('admins');
  });

  it('blocks non-admins from every admin event', async () => {
    const { user } = await setup();
    const other = sock('access_token=user');
    await connect(other);
    expect(gw.connect(other, { sessionId: user.id })).toEqual({ ok: false, error: 'forbidden' });
    gw.list(other);
    gw.say(other, { sessionId: user.id, text: 'hi' });
    expect(other.emit).not.toHaveBeenCalled();
    expect(user.emit).not.toHaveBeenCalled();
  });

  it('only relays lines while an admin holds the session, and only to that admin', async () => {
    const { admin, user } = await setup();
    gw.line(user, { kind: 'in', text: 'before' });
    expect(admin.emit).not.toHaveBeenCalled();

    expect(gw.connect(admin, { sessionId: user.id })).toEqual({ ok: true });
    expect(user.emit).toHaveBeenCalledWith('ee:admin', { connected: true, mode: 'AUTO' });
    gw.line(user, { kind: 'in', text: 'after' });
    expect(admin.emit).toHaveBeenCalledWith('ee:mirror', { sessionId: user.id, kind: 'in', text: 'after' });
    expect(adminEmit).not.toHaveBeenCalledWith('ee:mirror', expect.anything());
  });

  it('drops oversized, non-string and unknown-kind lines', async () => {
    const { admin, user } = await setup();
    gw.connect(admin, { sessionId: user.id });
    admin.emit.mockClear();
    gw.line(user, { kind: 'in', text: 'x'.repeat(MAX_TEXT + 1) });
    gw.line(user, { kind: 'in', text: { evil: true } });
    gw.line(user, { kind: 'html', text: 'x' });
    expect(admin.emit).not.toHaveBeenCalled();
  });

  it('lets a second admin see but not take a held session', async () => {
    const { user } = await setup();
    const a1 = sock('access_token=admin');
    const a2 = sock('access_token=admin2');
    await connect(a1);
    await connect(a2);
    gw.connect(a1, { sessionId: user.id });
    expect(gw.connect(a2, { sessionId: user.id })).toEqual({ ok: false, error: 'busy' });
    gw.mode(a2, { sessionId: user.id, mode: 'MANUAL' });
    expect(user.emit).not.toHaveBeenCalledWith('ee:admin', { connected: true, mode: 'MANUAL' });
  });

  it('delivers MANUAL replies only in MANUAL mode', async () => {
    const { admin, user } = await setup();
    gw.connect(admin, { sessionId: user.id });
    gw.say(admin, { sessionId: user.id, text: 'too early' });
    expect(user.emit).not.toHaveBeenCalledWith('ee:reply', expect.anything());
    gw.mode(admin, { sessionId: user.id, mode: 'MANUAL' });
    gw.say(admin, { sessionId: user.id, text: '  <b>hello</b>  ' });
    expect(user.emit).toHaveBeenCalledWith('ee:reply', { text: '<b>hello</b>' });
  });

  it('returns the user to AUTO when the admin releases or drops', async () => {
    const { admin, user } = await setup();
    gw.connect(admin, { sessionId: user.id });
    gw.mode(admin, { sessionId: user.id, mode: 'MANUAL' });
    gw.handleDisconnect(admin);
    expect(user.emit).toHaveBeenLastCalledWith('ee:admin', { connected: false, mode: 'AUTO' });
    gw.say(admin, { sessionId: user.id, text: 'ghost' });
    expect(user.emit).not.toHaveBeenCalledWith('ee:reply', expect.anything());
  });

  it('tells the admin when the user leaves', async () => {
    const { admin, user } = await setup();
    gw.connect(admin, { sessionId: user.id });
    gw.handleDisconnect(user);
    expect(admin.emit).toHaveBeenCalledWith('ee:ended', { sessionId: user.id });
    expect(gw.connect(admin, { sessionId: user.id })).toEqual({ ok: false, error: 'gone' });
  });

  it('rate-limits each socket', async () => {
    const { admin, user } = await setup();
    gw.connect(admin, { sessionId: user.id });
    admin.emit.mockClear();
    for (let i = 0; i < 50; i++) gw.line(user, { kind: 'in', text: `m${i}` });
    // join() already spent one event in this window
    expect(admin.emit.mock.calls.length).toBe(EVENTS_PER_SECOND - 1);
    jest.advanceTimersByTime(1100);
    gw.line(user, { kind: 'in', text: 'later' });
    expect(admin.emit).toHaveBeenLastCalledWith('ee:mirror', expect.objectContaining({ text: 'later' }));
  });
});
