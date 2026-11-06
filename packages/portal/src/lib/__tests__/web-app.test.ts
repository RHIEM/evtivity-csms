// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach } from 'vitest';
import { installWebAppLinks } from '../web-app';

function link(rel: string): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
}

describe('installWebAppLinks', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('links the manifest and the touch icon on the portal origin when the API shares it', () => {
    installWebAppLinks('');
    expect(link('manifest')?.getAttribute('href')).toBe('/v1/portal/manifest.webmanifest');
    expect(link('manifest')?.crossOrigin).toBeNull();
    expect(link('apple-touch-icon')?.getAttribute('href')).toBe('/v1/portal/app-icon/180.png');
  });

  it('points at an API on another origin and fetches the manifest with CORS', () => {
    installWebAppLinks('https://api.example.com/');
    expect(link('manifest')?.href).toBe('https://api.example.com/v1/portal/manifest.webmanifest');
    expect(link('manifest')?.crossOrigin).toBe('anonymous');
    expect(link('apple-touch-icon')?.href).toBe(
      'https://api.example.com/v1/portal/app-icon/180.png',
    );
  });

  it('reuses existing links instead of adding duplicates', () => {
    installWebAppLinks('');
    installWebAppLinks('');
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
    expect(document.querySelectorAll('link[rel="apple-touch-icon"]')).toHaveLength(1);
  });
});
