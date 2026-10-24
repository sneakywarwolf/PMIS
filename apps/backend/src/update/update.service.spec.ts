import { isNewer, UpdateService } from './update.service';

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('1.2.10', '1.2.9')).toBe(true);
    expect(isNewer('v2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0', '1.0.1')).toBe(false);
  });
});

describe('UpdateService.checkAndUpdate', () => {
  const make = (status: any) => {
    const svc: any = Object.create(UpdateService.prototype);
    svc.logger = { warn: jest.fn() };
    svc.getStatus = jest.fn().mockResolvedValue(status);
    svc.schedule = jest.fn().mockResolvedValue({});
    return svc;
  };
  const available = { latest: { available: true }, updaterConfigured: true, update: { status: 'IDLE' } };

  it('an Admin check with a newer version starts the update immediately', async () => {
    const svc = make(available);
    await svc.checkAndUpdate(true, 'admin1');
    expect(svc.schedule).toHaveBeenCalledWith(expect.any(String), 'admin1');
  });

  it.each([
    ['a non-admin', false, available],
    ['no newer version', true, { ...available, latest: { available: false } }],
    ['no updater configured', true, { ...available, updaterConfigured: false }],
    ['an update already scheduled', true, { ...available, update: { status: 'SCHEDULED' } }],
  ])('does not start an update for %s', async (_n, isAdmin, status) => {
    const svc = make(status);
    await svc.checkAndUpdate(isAdmin, 'u1');
    expect(svc.schedule).not.toHaveBeenCalled();
  });

  it('still returns the check result when the update cannot be started', async () => {
    const svc = make(available);
    svc.schedule.mockRejectedValue(new Error('refused'));
    await expect(svc.checkAndUpdate(true, 'admin1')).resolves.toBeDefined();
  });
});
