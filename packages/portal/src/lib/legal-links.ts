// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * RHIEM: The portal links the privacy policy and the imprint on rhiem.com
 * instead of its own content pages until the portal texts are approved.
 * German portal languages get the German pages, all others the English ones.
 */
export interface LegalLinks {
  privacy: string;
  imprint: string;
}

const GERMAN: LegalLinks = {
  privacy: 'https://www.rhiem.com/de/datenschutz/',
  imprint: 'https://www.rhiem.com/de/impressum/',
};

const ENGLISH: LegalLinks = {
  privacy: 'https://www.rhiem.com/en/data-protection/',
  imprint: 'https://www.rhiem.com/en/imprint/',
};

export function legalLinks(language: string | null | undefined): LegalLinks {
  return language?.toLowerCase().startsWith('de') === true ? GERMAN : ENGLISH;
}
