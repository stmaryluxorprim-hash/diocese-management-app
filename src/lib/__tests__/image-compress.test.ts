import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_DIM, SKIP_BELOW_BYTES, extensionFor, maxDimFor, planResize, shouldCompress, targetBytesFor,
} from '../image-compress.ts';

test('planResize never upscales and keeps aspect ratio', () => {
  assert.deepEqual(planResize(4000, 3000, 640), { width: 640, height: 480, scaled: true });
  assert.deepEqual(planResize(3000, 4000, 640), { width: 480, height: 640, scaled: true });
  assert.deepEqual(planResize(300, 200, 640), { width: 300, height: 200, scaled: false });
  assert.deepEqual(planResize(640, 640, 640), { width: 640, height: 640, scaled: false });
});

test('planResize survives degenerate input', () => {
  assert.deepEqual(planResize(0, 0, 640), { width: 1, height: 1, scaled: false });
  assert.equal(planResize(10000, 1, 640).height, 1);
});

test('shouldCompress: only big jpeg/png/webp', () => {
  assert.equal(shouldCompress('image/jpeg', 4_000_000), true);
  assert.equal(shouldCompress('image/png', SKIP_BELOW_BYTES + 1), true);
  assert.equal(shouldCompress('image/webp', 1_000_000), true);
  assert.equal(shouldCompress('image/jpeg', SKIP_BELOW_BYTES), false); // already small
  assert.equal(shouldCompress('image/gif', 5_000_000), false);         // would lose animation
  assert.equal(shouldCompress('image/svg+xml', 5_000_000), false);
  assert.equal(shouldCompress('image/heic', 5_000_000), false);
  assert.equal(shouldCompress('', 5_000_000), false);
});

test('maxDimFor: avatars small, content larger, unknown = default', () => {
  assert.equal(maxDimFor('servants'), 640);
  assert.equal(maxDimFor('persons'), 640);
  assert.equal(maxDimFor('messages'), 1280);
  assert.equal(maxDimFor('cards'), 1600);
  assert.equal(maxDimFor('something-new'), DEFAULT_MAX_DIM);
});

test('targetBytesFor grows with the size budget', () => {
  assert.ok(targetBytesFor(640) < targetBytesFor(800));
  assert.ok(targetBytesFor(800) < targetBytesFor(1280));
  assert.ok(targetBytesFor(1280) < targetBytesFor(1600));
});

test('extensionFor', () => {
  assert.equal(extensionFor('image/webp'), 'webp');
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('application/pdf'), '');
});
