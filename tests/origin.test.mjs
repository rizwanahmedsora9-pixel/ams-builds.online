// The site's name for itself: an admin's own title always wins, and until there
// is one the name follows the host that served the request. That is what makes
// one panel usable on several domains (a custom domain, the platform address, or
// a fresh deploy for another site) without retyping the title each time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayTitle, isPlaceholderTitle, siteNameFromHost, titleFor } from '../dist/origin.mjs';

test('a domain becomes a readable name', () => {
  assert.equal(siteNameFromHost('ams-builds.online'), 'Ams Builds');
  assert.equal(siteNameFromHost('www.ams-builds.online'), 'Ams Builds');
  assert.equal(siteNameFromHost('ams.vercel.app'), 'Ams');
  assert.equal(siteNameFromHost('ams.workers.dev'), 'Ams');
  assert.equal(siteNameFromHost('my-shop.example.co.uk'), 'My Shop');
  assert.equal(siteNameFromHost('AMS-BUILDS.ONLINE'), 'Ams Builds');
});

test('the same install names itself per domain', () => {
  // Nothing stored yet: each host gets its own name, which is what a panel
  // reused for a second domain should do.
  assert.equal(displayTitle('', 'ams-builds.online'), 'Ams Builds');
  assert.equal(displayTitle('', 'shop.vercel.app'), 'Shop');
  assert.equal(displayTitle('My Site', 'institute.vercel.app'), 'Institute');
  assert.equal(displayTitle(undefined, 'example.com'), 'Example');
});

test('a title an admin typed is never overridden', () => {
  assert.equal(displayTitle('AMS Builds', 'anything.example'), 'AMS Builds');
  assert.equal(displayTitle('AMS Builds', 'ams-builds.online'), 'AMS Builds');
  assert.equal(isPlaceholderTitle('AMS Builds'), false);
  assert.equal(isPlaceholderTitle('my site'), true);
  assert.equal(isPlaceholderTitle(''), true);
  assert.equal(isPlaceholderTitle(undefined), true);
});

test('an address that is not a name falls back instead of inventing one', () => {
  // Running on an IP (a test server, a LAN address) has no name to derive.
  assert.equal(siteNameFromHost('127.0.0.1:8787'), '');
  assert.equal(siteNameFromHost('192.168.1.10'), '');
  assert.equal(siteNameFromHost(''), '');
  assert.equal(displayTitle('', '127.0.0.1:8787'), '');
  assert.equal(displayTitle('Stored Name', '127.0.0.1:8787'), 'Stored Name');
  // A preview suffix is a generated id, not part of the name.
  assert.equal(siteNameFromHost('ams-3f2c9a.vercel.app'), 'Ams');
});

test('a request URL is enough to decide', () => {
  assert.equal(titleFor('', new URL('https://ams-builds.online/blog')), 'Ams Builds');
  assert.equal(titleFor('Renamed', new URL('https://other.example/')), 'Renamed');
});
