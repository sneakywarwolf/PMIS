import { VulnerabilitiesService } from './vulnerabilities.service';

describe('new vulnerability request notification', () => {
  const make = () => {
    const prisma: any = { vulnerability: { create: jest.fn(async ({ data }: any) => ({ id: 'v1 /x', ...data })) } };
    const notifications: any = { notifyAdminsAndTLs: jest.fn(), create: jest.fn() };
    const audit: any = { log: jest.fn() };
    return { svc: new VulnerabilitiesService(prisma, notifications, audit), notifications, audit };
  };
  const data = { name: 'SQLi', severity: 'High', description: 'd', impact: 'i', remediation: 'r', references: 'x' };

  it('points the notification at the Pending Approval tab of the Vulnerability Database page, focused on the request', async () => {
    const { svc, notifications } = make();
    await svc.request(data, 'tester-1');
    expect(notifications.notifyAdminsAndTLs).toHaveBeenCalledTimes(1);
    expect(notifications.notifyAdminsAndTLs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VULNERABILITY_REQUESTED',
        relatedId: 'v1 /x',
        excludeUserId: 'tester-1',
        // the id is URL-encoded so it can never add parameters or change the path
        linkUrl: '/dashboard/vulnerabilities?tab=pending&focus=v1%20%2Fx',
      }),
    );
  });

  it('sends one notification call and one audit entry per request (no duplicates)', async () => {
    const { svc, notifications, audit } = make();
    await svc.request(data, 'tester-1');
    expect(notifications.notifyAdminsAndTLs).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('only ever links to an in-app path', async () => {
    const { svc, notifications } = make();
    await svc.request(data, 'tester-1');
    const { linkUrl } = notifications.notifyAdminsAndTLs.mock.calls[0][0];
    expect(linkUrl.startsWith('/')).toBe(true);
    expect(linkUrl.startsWith('//')).toBe(false);
  });
});
