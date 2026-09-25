import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { authenticateSocket } from '../auth/verify-access-token';

type Stage = 'restricted' | 'terminal' | 'revealed';
type Mode = 'AUTO' | 'MANUAL';
type Session = {
  socket: Socket;
  user: { id: string; name: string; role: string };
  stage: Stage;
  attempts: number;
  max: number;
  lastActive: number;
  admin: Socket | null;
  mode: Mode;
};

export const MAX_SESSIONS = 200;
export const MAX_TEXT = 256;
export const EVENTS_PER_SECOND = 10;
const BROADCAST_MS = 500;
const STAGES = new Set<Stage>(['restricted', 'terminal', 'revealed']);
const MODES = new Set<Mode>(['AUTO', 'MANUAL']);
const LINE_KINDS = new Set(['in', 'out', 'sys', 'paste']);

const cleanText = (t: unknown): string | null => (typeof t === 'string' && t.length <= MAX_TEXT ? t : null);

// Terminal text is relayed between exactly two sockets and never stored or logged.
// ponytail: in-memory sessions assume one backend process; add the socket.io Redis adapter to scale out.
@WebSocketGateway({
  namespace: '/easter-egg',
  path: '/ee-socket',
  addTrailingSlash: false,
  transports: ['polling'],
  maxHttpBufferSize: 4096,
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
})
export class EasterEggGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Namespace;

  private readonly sessions = new Map<string, Session>();
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    private prismaService: PrismaService,
  ) {}

  // Auth runs as namespace middleware so no event is handled before client.data.user exists.
  afterInit(server: Namespace) {
    server.use((client, next) => {
      this.authenticate(client).then((ok) => next(ok ? undefined : new Error('unauthorized')), () => next(new Error('unauthorized')));
    });
  }

  async authenticate(client: Socket): Promise<boolean> {
    const user = await authenticateSocket(client.handshake.headers.cookie, this.jwtService, this.redisService, this.prismaService);
    if (!user) return false;
    client.data.user = { id: user.id, name: user.fullName || user.username, role: user.role };
    return true;
  }

  handleConnection(client: Socket) {
    if (!client.data.user) return client.disconnect(true);
    if (client.data.user.role === 'ADMIN') client.join('admins');
  }

  handleDisconnect(client: Socket) {
    const own = this.sessions.get(client.id);
    if (own) {
      this.sessions.delete(client.id);
      own.admin?.emit('ee:ended', { sessionId: client.id });
      this.scheduleBroadcast();
    }
    for (const s of this.sessions.values()) if (s.admin?.id === client.id) this.release(s);
  }

  // ---- user side ----

  @SubscribeMessage('ee:join')
  join(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    if (!this.allow(client)) return;
    let s = this.sessions.get(client.id);
    if (!s) {
      if (this.sessions.size >= MAX_SESSIONS) return;
      s = { socket: client, user: client.data.user, stage: 'restricted', attempts: 0, max: 40, lastActive: Date.now(), admin: null, mode: 'AUTO' };
      this.sessions.set(client.id, s);
    }
    this.applyStatus(s, body);
  }

  @SubscribeMessage('ee:status')
  status(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    const s = this.sessions.get(client.id);
    if (s && this.allow(client)) this.applyStatus(s, body);
  }

  @SubscribeMessage('ee:line')
  line(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    const s = this.sessions.get(client.id);
    if (!s?.admin || !this.allow(client)) return;
    const text = cleanText(body?.text);
    if (text === null || !LINE_KINDS.has(body?.kind)) return;
    s.lastActive = Date.now();
    s.admin.emit('ee:mirror', { sessionId: client.id, kind: body.kind, text });
  }

  // ---- admin side ----

  @SubscribeMessage('ee:list')
  list(@ConnectedSocket() client: Socket) {
    if (this.isAdmin(client)) client.emit('ee:sessions', this.snapshot());
  }

  @SubscribeMessage('ee:connect')
  connect(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    if (!this.isAdmin(client)) return { ok: false, error: 'forbidden' };
    const s = this.sessions.get(body?.sessionId);
    if (!s) return { ok: false, error: 'gone' };
    if (s.admin && s.admin.id !== client.id) return { ok: false, error: 'busy' };
    for (const other of this.sessions.values()) if (other !== s && other.admin?.id === client.id) this.release(other);
    s.admin = client;
    s.mode = 'AUTO';
    s.socket.emit('ee:admin', { connected: true, mode: s.mode });
    this.scheduleBroadcast();
    return { ok: true };
  }

  @SubscribeMessage('ee:mode')
  mode(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    const s = this.held(client, body);
    if (!s || !MODES.has(body?.mode)) return;
    s.mode = body.mode;
    s.socket.emit('ee:admin', { connected: true, mode: s.mode });
    this.scheduleBroadcast();
  }

  @SubscribeMessage('ee:say')
  say(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    const s = this.held(client, body);
    if (!s || s.mode !== 'MANUAL') return;
    const text = cleanText(body?.text)?.trim();
    if (text) s.socket.emit('ee:reply', { text });
  }

  @SubscribeMessage('ee:release')
  releaseSession(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    const s = this.held(client, body);
    if (s) this.release(s);
  }

  // ---- internals ----

  private allow(client: Socket): boolean {
    if (!client.data.user) return false;
    const now = Date.now();
    const r = (client.data.rate ??= { start: now, count: 0 });
    if (now - r.start >= 1000) {
      r.start = now;
      r.count = 0;
    }
    return ++r.count <= EVENTS_PER_SECOND;
  }

  private isAdmin(client: Socket): boolean {
    return this.allow(client) && client.data.user.role === 'ADMIN';
  }

  private held(client: Socket, body: any): Session | null {
    if (!this.isAdmin(client)) return null;
    const s = this.sessions.get(body?.sessionId);
    return s && s.admin?.id === client.id ? s : null;
  }

  private release(s: Session) {
    s.admin = null;
    s.mode = 'AUTO';
    s.socket.emit('ee:admin', { connected: false, mode: 'AUTO' });
    this.scheduleBroadcast();
  }

  private applyStatus(s: Session, body: any) {
    if (STAGES.has(body?.stage)) s.stage = body.stage;
    if (Number.isInteger(body?.attempts) && body.attempts >= 0 && body.attempts <= 50) s.attempts = body.attempts;
    if (Number.isInteger(body?.max) && body.max >= 30 && body.max <= 50) s.max = body.max;
    s.lastActive = Date.now();
    this.scheduleBroadcast();
  }

  private snapshot() {
    return {
      now: Date.now(),
      sessions: [...this.sessions.values()].map((s) => ({
        id: s.socket.id,
        name: s.user.name,
        role: s.user.role,
        stage: s.stage,
        attempts: s.attempts,
        max: s.max,
        lastActive: s.lastActive,
        admin: s.admin?.data.user.name ?? null,
        mode: s.mode,
      })),
    };
  }

  private scheduleBroadcast() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.server?.to('admins').emit('ee:sessions', this.snapshot());
    }, BROADCAST_MS);
  }
}
