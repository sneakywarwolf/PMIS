import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Regression guard for deployment hardening: these settings were added after a security audit and must not be dropped silently.
const root = join(__dirname, '..', '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const service = (compose: string, name: string) => {
  const m = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|^\\S|$(?![\\s\\S]))`, 'm'));
  if (!m) throw new Error(`service ${name} not found`);
  return m[1];
};

describe('docker-compose.yml hardening', () => {
  const compose = read('docker-compose.yml');

  it.each(['frontend', 'backend'])('%s: no new privileges, no capabilities, read-only root, bounded processes', (name) => {
    const s = service(compose, name);
    expect(s).toMatch(/no-new-privileges:true/);
    expect(s).toMatch(/cap_drop:\n\s+- ALL/);
    expect(s).toMatch(/read_only: true/);
    expect(s).toMatch(/pids_limit: \d+/);
  });

  it('redis requires a password, and the backend connects with it', () => {
    expect(service(compose, 'redis')).toMatch(/--requirepass/);
    expect(service(compose, 'backend')).toMatch(/REDIS_URL: redis:\/\/:\$\{REDIS_PASSWORD:\?/);
  });

  it('redis starts through the image entrypoint (so it drops to the redis user) with a minimal capability set', () => {
    const redis = service(compose, 'redis');
    expect(redis).toMatch(/command: \["redis-server",/); // a shell wrapper would leave Redis running as root
    expect(redis).toMatch(/cap_drop:\n\s+- ALL/);
    expect(redis).not.toMatch(/cap_add:[\s\S]*(SYS_ADMIN|NET_ADMIN|SYS_PTRACE)/);
  });

  it('postgres and rustfs drop all capabilities', () => {
    for (const name of ['postgres', 'rustfs']) expect(service(compose, name)).toMatch(/cap_drop:\n\s+- ALL/);
  });

  it('app containers have a memory ceiling', () => {
    for (const name of ['frontend', 'backend']) expect(service(compose, name)).toMatch(/mem_limit:/);
  });

  it('only the frontend publishes a port', () => {
    for (const name of ['backend', 'postgres', 'redis', 'rustfs']) expect(service(compose, name)).not.toMatch(/^\s+ports:/m);
    expect(service(compose, 'frontend')).toMatch(/^\s+ports:/m);
  });

  it('never mounts the Docker socket or runs privileged', () => {
    expect(compose).not.toMatch(/docker\.sock|privileged:\s*true|network_mode:\s*host/);
  });

  it('.env.example lists the redis secret', () => {
    expect(read('.env.example')).toMatch(/^REDIS_PASSWORD=CHANGE_ME$/m);
  });
});

describe('docker-compose.dev.yml', () => {
  it('publishes every port on loopback only (it uses fixed, well-known credentials)', () => {
    const ports = [...read('docker-compose.dev.yml').matchAll(/^\s+- "([^"]+:\d+)"$/gm)].map((m) => m[1]);
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) expect(p).toMatch(/^127\.0\.0\.1:/);
  });
});

describe('GitHub workflows', () => {
  const dir = join(root, '.github', 'workflows');
  it('every third-party action is pinned to a commit SHA', () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.yml'))) {
      for (const m of read('.github', 'workflows', f).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        expect(`${f}: ${m[1]}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it('the downloaded gitleaks binary is checksum-verified', () => {
    expect(read('.github', 'workflows', 'security.yml')).toMatch(/sha256sum -c/);
  });
});
