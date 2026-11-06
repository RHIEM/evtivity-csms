// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { API_BASE_URL } from '@/lib/config';

function setLink(rel: string, href: string, crossOrigin: boolean): void {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (link == null) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  if (crossOrigin) link.crossOrigin = 'anonymous';
  link.href = href;
}

/**
 * Links the web app manifest and the iOS home screen icon, both served by the
 * API from the company branding. Set here rather than in index.html because the
 * API can run on another origin (runtime-config.js).
 */
export function installWebAppLinks(apiBaseUrl: string = API_BASE_URL): void {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const crossOrigin =
    base !== '' && new URL(base, window.location.href).origin !== window.location.origin;
  setLink('manifest', `${base}/v1/portal/manifest.webmanifest`, crossOrigin);
  setLink('apple-touch-icon', `${base}/v1/portal/app-icon/180.png`, false);
}
