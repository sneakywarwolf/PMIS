import { ConflictException, BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Application updates replace code only. This module never touches operational data: it has no
 * reset/seed/migrate-reset path, it stores its own state in a dedicated `app_settings` row, and
 * the install step is an operator-supplied command (UPDATE_COMMAND) that is refused if it looks
 * like a reset. Schema migrations, when a release needs them, ship as versioned additive
 * `prisma migrate deploy` migrations — never as part of a reset workflow.
 */

const STATE_ID = 'update-state';
const LOCK_KEY = 'update:lock';
const REMINDER_MS = 10 * 60 * 1000;
const CHECK_TTL_MS = 10 * 60 * 1000;
const FORCE_COOLDOWN_MS = 30 * 1000;
const DESTRUCTIVE = /\b(reset|seed|drop|truncate|wipe)\b|--force-reset|db\s+push/i;

export type UpdateStatus = 'IDLE' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface UpdateState {
  status: UpdateStatus;
  scheduledAt?: string;
  scheduledBy?: string;
  targetVersion?: string;
  fromVersion?: string;
  startedAt?: string;
  finishedAt?: string;
  reminded?: boolean;
  error?: string;
}

export interface Release {
  version: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
}

/** True when a > b, comparing dotted numeric versions ("v1.2.10" > "1.2.9"). */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

@Injectable()
export class UpdateService implements OnModuleInit {
  private readonly logger = new Logger(UpdateService.name);
  private cache: { at: number; releases: Release[]; changelog: string; error?: string } | null = null;
  readonly version = process.env.APP_VERSION || this.readPackageVersion();
  private readonly timeoutMs = parseInt(process.env.UPDATE_TIMEOUT_MS || '1800000', 10);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private notifications: NotificationsService,
  ) {}

  private readPackageVersion(): string {
    try {
      return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
    } catch {
      return '0.0.0';
    }
  }

  /** After a restart: an update that was IN_PROGRESS either finished (version changed) or died. */
  async onModuleInit() {
    const s = await this.getState();
    if (s.status !== 'IN_PROGRESS') return;
    if (s.fromVersion && s.fromVersion !== this.version) {
      await this.setState({ ...s, status: 'COMPLETED', finishedAt: new Date().toISOString() });
    } else if (Date.now() - new Date(s.startedAt!).getTime() > this.timeoutMs) {
      await this.setState({ ...s, status: 'FAILED', finishedAt: new Date().toISOString(), error: 'Update did not complete' });
    } else {
      return;
    }
    // The process that held the lock was restarted by the update and can no longer release it;
    // without this a newly scheduled update would wait up to timeout+60s for the lock to expire.
    await this.redis.del(LOCK_KEY);
  }

  async getState(): Promise<UpdateState> {
    const row = await this.prisma.appSettings.findUnique({ where: { id: STATE_ID } });
    return (row?.data as unknown as UpdateState) ?? { status: 'IDLE' };
  }

  private async setState(state: UpdateState) {
    const data = JSON.parse(JSON.stringify(state));
    await this.prisma.appSettings.upsert({
      where: { id: STATE_ID },
      create: { id: STATE_ID, data },
      update: { data },
    });
  }

  private async fetchReleases(force: boolean): Promise<{ releases: Release[]; changelog: string; error?: string }> {
    // A forced check is still rate-limited: any user can press "Check for updates", and GitHub only
    // allows ~60 unauthenticated calls/hour per server, so repeated presses reuse the fresh result.
    const maxAge = force ? FORCE_COOLDOWN_MS : CHECK_TTL_MS;
    if (this.cache && Date.now() - this.cache.at < maxAge) return this.cache;
    const repo = process.env.UPDATE_REPO || 'sneakywarwolf/PMIS';
    // UPDATE_API_URL: GitHub-compatible releases endpoint override (mirrors / air-gapped sites / tests).
    const url = process.env.UPDATE_API_URL || `https://api.github.com/repos/${repo}/releases?per_page=10`;
    // UPDATE_GITHUB_TOKEN: read-only token, only needed while the repo is private. Server-side only.
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'pmis-update-check' };
    if (process.env.UPDATE_GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.UPDATE_GITHUB_TOKEN}`;
    // Changelog comes from the repo itself; the bundled file is only a fallback (offline / not published yet).
    const changelogP = process.env.UPDATE_API_URL
      ? Promise.resolve('')
      : fetch(`https://raw.githubusercontent.com/${repo}/HEAD/apps/backend/CHANGELOG.md`, { headers, signal: AbortSignal.timeout(8000) })
          .then((r) => (r.ok ? r.text() : ''))
          .catch(() => '');
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
      const releases: Release[] = (await res.json())
        .filter((r: any) => !r.draft && !r.prerelease)
        .map((r: any) => ({
          version: String(r.tag_name).replace(/^v/i, ''),
          name: r.name || r.tag_name,
          notes: r.body || '',
          url: r.html_url,
          publishedAt: r.published_at,
        }));
      this.cache = { at: Date.now(), releases, changelog: (await changelogP) || this.localChangelog() };
    } catch (e: any) {
      // Keep the last good result so a transient outage doesn't hide a known update.
      this.cache = {
        at: Date.now(),
        releases: this.cache?.releases ?? [],
        changelog: this.cache?.changelog || this.localChangelog(),
        error: e.message,
      };
    }
    return this.cache!;
  }

  private localChangelog(): string {
    const p = join(process.cwd(), 'CHANGELOG.md');
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  }

  async getStatus(force = false, isAdmin = false) {
    const [state, { releases, changelog, error }] = await Promise.all([this.getState(), this.fetchReleases(force)]);
    const latest = releases.find((r, _, all) => all.every((o) => !isNewer(o.version, r.version)));
    return {
      appName: process.env.APP_NAME || 'PMIS - Project Management for Information Security',
      version: this.version,
      changelog,
      latest: latest ? { ...latest, available: isNewer(latest.version, this.version) } : null,
      releases,
      checkError: error ?? null,
      updaterConfigured: !!process.env.UPDATE_COMMAND,
      // Operator-only fields (who scheduled it, failure detail) are not exposed to other roles.
      update: isAdmin ? state : { ...state, scheduledBy: undefined, error: state.error ? 'Update failed' : undefined },
      serverTime: new Date().toISOString(),
    };
  }

  async schedule(scheduledAt: unknown, userId: string) {
    const when = new Date(String(scheduledAt));
    if (isNaN(when.getTime())) throw new BadRequestException('scheduledAt must be a valid date/time');
    if (when.getTime() < Date.now() - 60_000) throw new BadRequestException('scheduledAt must not be in the past');
    if (!process.env.UPDATE_COMMAND) throw new ConflictException('No updater is configured on this server (UPDATE_COMMAND)');
    if (DESTRUCTIVE.test(process.env.UPDATE_COMMAND)) throw new ConflictException('UPDATE_COMMAND looks destructive and was refused');

    const state = await this.getState();
    if (state.status === 'SCHEDULED' || state.status === 'IN_PROGRESS') {
      throw new ConflictException('An update is already scheduled or running');
    }
    const status = await this.getStatus(true);
    if (!status.latest?.available) throw new ConflictException('No newer version is available');

    const next: UpdateState = {
      status: 'SCHEDULED',
      scheduledAt: when.toISOString(),
      scheduledBy: userId,
      targetVersion: status.latest.version,
      fromVersion: this.version,
    };
    await this.setState(next);
    await this.notifications.notifyAllActiveUsers({
      type: 'SYSTEM_UPDATE',
      title: 'System update scheduled',
      message: `PMIS will update to v${next.targetVersion} at ${when.toLocaleString()}. The system will be unavailable briefly.`,
      linkUrl: '/dashboard/about',
    });
    return next;
  }

  async cancel() {
    const state = await this.getState();
    if (state.status !== 'SCHEDULED') throw new ConflictException('No scheduled update to cancel');
    await this.setState({ status: 'IDLE' });
    return { status: 'IDLE' };
  }

  @Cron('*/20 * * * * *')
  async tick() {
    const s = await this.getState();
    if (s.status !== 'SCHEDULED') return;
    const due = new Date(s.scheduledAt!).getTime() - Date.now();
    if (due > 0 && due <= REMINDER_MS && !s.reminded) {
      await this.setState({ ...s, reminded: true });
      await this.notifications.notifyAllActiveUsers({
        type: 'SYSTEM_UPDATE',
        title: 'System update starting soon',
        message: `PMIS will update to v${s.targetVersion} in about ${Math.ceil(due / 60000)} minute(s). Please save your work.`,
        linkUrl: '/dashboard/about',
      });
    }
    if (due <= 0) await this.run();
  }

  private async run() {
    // Redis NX lock: only one instance/tick may execute, even if ticks overlap.
    const locked = await this.redis.set(LOCK_KEY, '1', 'PX', this.timeoutMs + 60_000, 'NX');
    if (!locked) return;
    try {
      const s = await this.getState();
      if (s.status !== 'SCHEDULED') return;
      const started: UpdateState = { ...s, status: 'IN_PROGRESS', startedAt: new Date().toISOString() };
      await this.setState(started);
      const cmd = process.env.UPDATE_COMMAND;
      const failure = !cmd || DESTRUCTIVE.test(cmd) ? 'Updater not configured or refused' : await this.exec(cmd);
      if (failure) {
        await this.setState({ ...started, status: 'FAILED', finishedAt: new Date().toISOString(), error: failure });
      } else {
        await this.setState({ ...started, status: 'COMPLETED', finishedAt: new Date().toISOString() });
        await this.notifications.notifyAllActiveUsers({
          type: 'SYSTEM_UPDATE',
          title: 'System update complete',
          message: `PMIS is now running v${started.targetVersion}.`,
          linkUrl: '/dashboard/about',
        });
      }
    } finally {
      await this.redis.del(LOCK_KEY);
    }
  }

  /** Runs the operator's update command; resolves to an error string, or '' on success. */
  private exec(cmd: string): Promise<string> {
    return new Promise((resolve) => {
      let tail = '';
      const child = spawn(cmd, { shell: true, cwd: process.env.UPDATE_WORKDIR || undefined, timeout: this.timeoutMs });
      const keep = (b: Buffer) => (tail = (tail + b).slice(-500));
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.on('error', (e) => resolve(e.message));
      child.on('close', (code) => {
        if (code !== 0) this.logger.error(`Update command exited ${code}: ${tail}`);
        // Output stays in server logs only; it can contain paths/hostnames/tokens and is never stored or returned.
        resolve(code === 0 ? '' : `Update command exited with code ${code} (see server logs)`);
      });
    });
  }
}
