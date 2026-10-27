import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureFormats, formatDate, formatDateTime, formatDateTimeSeconds, formatNumber, formatTime } from './datetime.ts';

const d = new Date(2026, 9, 27, 15, 5, 9); // 27 Oct 2026, 15:05:09 local

test('defaults: DD/MM/YYYY, 24-hour, en-IN', () => {
  configureFormats();
  assert.equal(formatDate(d), '27/10/2026');
  assert.equal(formatTime(d), '15:05');
  assert.equal(formatDateTime(d), '27/10/2026, 15:05');
  assert.equal(formatDateTimeSeconds(d), '27/10/2026, 15:05:09');
  assert.equal(formatNumber(1234567), '12,34,567');
});

test('the Admin\'s date format applies to every date', () => {
  configureFormats({ dateFormat: 'MM/DD/YYYY' });
  assert.equal(formatDate(d), '10/27/2026');
  configureFormats({ dateFormat: 'YYYY-MM-DD' });
  assert.equal(formatDateTime(d), '2026-10-27, 15:05');
});

test('12-hour time, with midnight and noon', () => {
  configureFormats({ timeFormat: '12h' });
  assert.equal(formatTime(d), '3:05 PM');
  assert.equal(formatDateTimeSeconds(d), '27/10/2026, 3:05:09 PM');
  assert.equal(formatTime(new Date(2026, 0, 1, 0, 7)), '12:07 AM');
  assert.equal(formatTime(new Date(2026, 0, 1, 12, 0)), '12:00 PM');
});

test('number locale', () => {
  configureFormats({ numberFormat: 'en-US' });
  assert.equal(formatNumber(1234567), '1,234,567');
  configureFormats({ numberFormat: 'de-DE' });
  assert.equal(formatNumber(1234567), '1.234.567');
});

test('unknown values and invalid dates fall back safely', () => {
  configureFormats({ dateFormat: 'nope' as any, timeFormat: 'x' as any, numberFormat: '' });
  assert.equal(formatDate(d), '27/10/2026');
  assert.equal(formatTime(d), '15:05');
  assert.equal(formatDate('not a date'), '');
  assert.equal(formatNumber(5), '5');
  configureFormats({ numberFormat: 'not-a-locale-$$' });
  assert.equal(formatNumber(5000), '5000');
  configureFormats();
});
