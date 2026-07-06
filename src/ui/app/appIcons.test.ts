import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * E-2: favicon / apple-touch-icon / PWA manifest wiring. The image assets
 * themselves are out of unit-test scope, but these string/JSON assertions pin
 * the HTML references and the manifest contract so the icons can never silently
 * detach (Lighthouse installable audit prerequisites).
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

describe('E-2 app icon + manifest wiring', () => {
  it('index.html links every icon variant, the manifest and a theme-color', () => {
    const html = read('index.html');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg"');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toMatch(/<meta name="theme-color" content="#3D6CB0"/);
  });

  it('gallery.html carries the favicon references', () => {
    const html = read('gallery.html');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/favicon.svg"');
  });

  it('manifest.webmanifest satisfies the installability contract', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    expect(manifest.name).toBe('Lexia');
    expect(manifest.short_name).toBe('Lexia');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toBe('#3D6CB0');
    expect(manifest.background_color).toBe('#F6F8FA');

    const bySize: Record<string, { type: string; purpose: string }> = {};
    for (const icon of manifest.icons) bySize[icon.sizes] = icon;
    // Lighthouse requires at least a 192px and a 512px PNG.
    for (const size of ['192x192', '512x512']) {
      const icon = bySize[size];
      expect(icon, size).toBeDefined();
      expect(icon?.type).toBe('image/png');
      expect(icon?.purpose).toContain('maskable');
    }
  });

  it('every referenced icon asset exists in public/', () => {
    for (const asset of [
      'favicon.svg',
      'favicon.ico',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'manifest.webmanifest',
    ]) {
      expect(existsSync(resolve(ROOT, 'public', asset)), asset).toBe(true);
    }
  });
});
