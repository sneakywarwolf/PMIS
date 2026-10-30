import { formatReportDate, placeholderDateFormats, DEFAULT_PLACEHOLDER_DATE_FORMATS } from './report-date-format';
import { ReportsService } from '../reports/reports.service';

const d = new Date(2026, 9, 5);
const svc = Object.create(ReportsService.prototype) as any;

describe('date placeholder formats', () => {
  afterEach(() => placeholderDateFormats.set(undefined));

  it('defaults print exactly what reports printed before', () => {
    expect(DEFAULT_PLACEHOLDER_DATE_FORMATS).toEqual({ startDate: 'Month DD, YYYY', endDate: 'DD-MM-YYYY', generationDate: 'Month DD, YYYY' });
    expect(svc.formatReportDate(d)).toBe('October 05, 2026');
    expect(svc.formatEndDate(d)).toBe('05-10-2026');
    expect(svc.formatReportDate(d, 'generationDate')).toBe('October 05, 2026');
    expect(formatReportDate(d, 'YYYY-MM-DD')).toBe('2026-10-05');
  });

  it('each placeholder follows its own setting', () => {
    placeholderDateFormats.set({ startDate: 'DD/MM/YYYY', endDate: 'YYYY-MM-DD', generationDate: 'DD.MM.YYYY' });
    expect(svc.formatReportDate(d)).toBe('05/10/2026');
    expect(svc.formatEndDate(d)).toBe('2026-10-05');
    expect(svc.formatReportDate(d, 'generationDate')).toBe('05.10.2026');
  });

  it('ignores unknown keys and unsupported formats, and empty dates stay empty', () => {
    placeholderDateFormats.set({ startDate: 'nonsense', bogus: 'DD-MM-YYYY' });
    expect(svc.formatReportDate(d)).toBe('October 05, 2026');
    expect(svc.formatEndDate(null)).toBe('');
  });
});
