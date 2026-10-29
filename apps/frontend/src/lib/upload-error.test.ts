import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeUploadError } from './upload-error.ts';

const MB = 1024 * 1024;
const ctx = { fileSize: 280 * MB, uploaded: 280 * MB, elapsed: 125 };

test('a message from PMIS is shown as it is', () => {
  assert.equal(describeUploadError({ response: { status: 400, data: { message: 'No findings were found in the file.' } } }, ctx), 'No findings were found in the file.');
  assert.equal(describeUploadError({ response: { status: 400, data: { message: ['a', 'b'] } } }, ctx), 'a b');
});

test('413 points at the limits on the way', () => {
  assert.match(describeUploadError({ response: { status: 413 } }, ctx), /client_max_body_size/);
});

test('a gateway error says how long it ran and what to do', () => {
  const m = describeUploadError({ response: { status: 504 } }, ctx);
  assert.match(m, /HTTP 504/);
  assert.match(m, /2:05/);
});

test('no answer at all, mid-upload: dropped connection or a proxy limit', () => {
  const m = describeUploadError({ code: 'ERR_NETWORK' }, { fileSize: 280 * MB, uploaded: 100 * MB, elapsed: 40 });
  assert.match(m, /while uploading/);
  assert.match(m, /100 MB of 280 MB/);
});

test('no answer after the whole file was sent: the server stopped while working', () => {
  const m = describeUploadError({ code: 'ERR_NETWORK' }, ctx);
  assert.match(m, /whole file/);
  assert.match(m, /run out of memory/);
});

test('other 5xx, 401, 403 and the fallback', () => {
  assert.match(describeUploadError({ response: { status: 500 } }, ctx), /HTTP 500/);
  assert.match(describeUploadError({ response: { status: 401 } }, ctx), /Sign in/);
  assert.match(describeUploadError({ response: { status: 403 } }, ctx), /not allowed/);
  assert.equal(describeUploadError({ response: { status: 418 } }, ctx, 'x'), 'x');
});
