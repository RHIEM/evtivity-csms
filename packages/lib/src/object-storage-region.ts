// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The region an S3-compatible provider signs with when the operator leaves
 * Region empty. MinIO's own default is us-east-1; providers with regional
 * endpoints (such as Wasabi) need the bucket's region instead. Browser-safe:
 * the API, the storage loader and the CSMS settings form share it.
 */
export const S3_COMPATIBLE_DEFAULT_REGION = 'us-east-1';

/**
 * The region the storage client uses: the stored region (trimmed) when set,
 * else the S3-compatible default for an S3-compatible provider, else null
 * (AWS S3 needs a region, so storage stays off without one).
 */
export function effectiveStorageRegion(provider: unknown, region: unknown): string | null {
  const trimmed = typeof region === 'string' ? region.trim() : '';
  if (trimmed !== '') return trimmed;
  return provider === 's3-compatible' ? S3_COMPATIBLE_DEFAULT_REGION : null;
}
