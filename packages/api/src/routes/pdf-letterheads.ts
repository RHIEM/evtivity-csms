// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  db,
  invoices,
  pdfLetterheads,
  settingAuditLog,
  settings,
  writeAudit,
} from '@evtivity/database';
import {
  DEFAULT_PDF_LETTERHEAD_LAYOUT,
  MAX_PDF_LETTERHEAD_BYTES,
  MAX_PDF_LETTERHEAD_NAME_LENGTH,
  MIN_PDF_LETTERHEAD_FIRST_PAGE_TEXT_MM,
  MIN_PDF_LETTERHEAD_PNG_WIDTH,
  MIN_PDF_LETTERHEAD_TEXT_WIDTH_MM,
  PDF_LETTERHEAD_KEY,
  PDF_LETTERHEAD_LAYOUT_RANGES,
  normalizePdfLetterheadImage,
  normalizePdfLetterheadLayout,
  normalizePdfLetterheadName,
} from '@evtivity/lib';
import type { PdfLetterheadImageError, PdfLetterheadLayout } from '@evtivity/lib';
import { generatePdfLetterheadPreview } from '@evtivity/services/invoice-letterhead-preview';
import { INVOICE_LANGUAGES } from '@evtivity/services/invoice-labels';
import {
  letterheadBackground,
  resolveInvoicePdfLanguage,
} from '@evtivity/services/invoice-pdf.service';
import { zodSchema } from '../lib/zod-schema.js';
import { arrayResponse, errorWith, itemResponse } from '../lib/response-schemas.js';
import { ERROR_CODES } from '../lib/error-codes.generated.js';
import { requireAllSiteAccess } from '../lib/site-access.js';
import { authorize } from '../middleware/rbac.js';
import { getAuditActor } from '../lib/audit-actor.js';

// Company-wide configuration: a site-restricted user gets this 404 before any
// read or write (requireAllSiteAccess, features/site-access-control.md).
const LETTERHEAD_NOT_FOUND = {
  error: 'PDF letterhead not found',
  code: 'PDF_LETTERHEAD_NOT_FOUND',
} as const;

/** A data URI of MAX_PDF_LETTERHEAD_BYTES in base64, plus the layout fields. */
const UPLOAD_BODY_LIMIT = Math.ceil((MAX_PDF_LETTERHEAD_BYTES * 4) / 3) + 64 * 1024;

const MAX_LETTERHEAD_KB = MAX_PDF_LETTERHEAD_BYTES / 1024;

const IMAGE_ERRORS: Record<PdfLetterheadImageError, string> = {
  format: 'image must be a readable PNG or SVG data URI',
  size: `image must be at most ${String(MAX_LETTERHEAD_KB)} KB`,
  aspect: `image must have the aspect ratio of A4 portrait (210 x 297 mm)`,
  resolution: `a PNG image must be at least ${String(MIN_PDF_LETTERHEAD_PNG_WIDTH)} pixels wide`,
};

const INVALID_LAYOUT = {
  error: `The layout is invalid: each value in mm within its range, at least ${String(MIN_PDF_LETTERHEAD_FIRST_PAGE_TEXT_MM)} mm between contentTopMm and contentBottomMm, and at least ${String(MIN_PDF_LETTERHEAD_TEXT_WIDTH_MM)} mm between the side margins`,
  code: 'VALIDATION_ERROR',
} as const;

const INVALID_NAME = {
  error: `name must be 1 to ${String(MAX_PDF_LETTERHEAD_NAME_LENGTH)} characters`,
  code: 'VALIDATION_ERROR',
} as const;

function mmField(key: keyof PdfLetterheadLayout, description: string) {
  const range = PDF_LETTERHEAD_LAYOUT_RANGES[key];
  return z
    .number()
    .min(range.min)
    .max(range.max)
    .describe(
      `${description}, in mm (${String(range.min)} to ${String(range.max)}, default ${String(DEFAULT_PDF_LETTERHEAD_LAYOUT[key])})`,
    );
}

const layoutFields = {
  addressLeftMm: mmField('addressLeftMm', 'Left edge of the recipient address'),
  addressTopMm: mmField('addressTopMm', 'Top of the recipient address'),
  contentTopMm: mmField('contentTopMm', 'Where the text of the first page starts'),
  contentBottomMm: mmField('contentBottomMm', 'Where the text of every page ends'),
  marginLeftMm: mmField('marginLeftMm', 'Left margin of the text'),
  marginRightMm: mmField('marginRightMm', 'Right margin of the text'),
};

const imageField = z
  .string()
  .describe(
    `The whole A4 portrait page as a PNG (at least ${String(MIN_PDF_LETTERHEAD_PNG_WIDTH)} px wide) or SVG data URI of at most ${String(MAX_LETTERHEAD_KB)} KB; an SVG is stored sanitized`,
  );

const createBody = z.object({
  name: z.string().max(MAX_PDF_LETTERHEAD_NAME_LENGTH).describe('Name of the version'),
  image: imageField,
  ...layoutFields,
  activate: z
    .boolean()
    .optional()
    .describe('Make the new version current right away (pdf.letterhead); default false'),
});

const previewBody = z.object({
  image: imageField,
  ...layoutFields,
  language: z
    .enum(INVOICE_LANGUAGES)
    .optional()
    .describe('Language of the sample invoice; default English'),
});

const currentBody = z.object({
  letterheadId: z
    .string()
    .nullable()
    .describe('The version new invoices and credit notes are issued under; null for none'),
});

const currentResponse = z.object({
  letterheadId: z.string().nullable().describe('The current version; null for none'),
});

const letterheadItem = z
  .object({
    id: z.string(),
    name: z.string(),
    imageSha256: z.string().describe('SHA-256 of the image bytes'),
    addressLeftMm: z.number(),
    addressTopMm: z.number(),
    contentTopMm: z.number(),
    contentBottomMm: z.number(),
    marginLeftMm: z.number(),
    marginRightMm: z.number(),
    createdByUserId: z.string().nullable(),
    createdAt: z.coerce.date(),
    current: z
      .boolean()
      .describe('New invoices and credit notes are issued under this version (pdf.letterhead)'),
    invoiceCount: z.number().describe('Invoices and credit notes issued under this version'),
  })
  .loose();

const imageResponse = z.object({
  image: z.string().describe('The stored PNG or SVG data URI'),
});

const idParams = z.object({ id: z.string().describe('PDF letterhead version identifier') });

/**
 * The columns of a version without its image (up to 2 MB): lists, responses
 * and the audit trail never carry it, GET .../image returns it.
 */
const versionColumns = {
  id: pdfLetterheads.id,
  name: pdfLetterheads.name,
  imageSha256: pdfLetterheads.imageSha256,
  addressLeftMm: pdfLetterheads.addressLeftMm,
  addressTopMm: pdfLetterheads.addressTopMm,
  contentTopMm: pdfLetterheads.contentTopMm,
  contentBottomMm: pdfLetterheads.contentBottomMm,
  marginLeftMm: pdfLetterheads.marginLeftMm,
  marginRightMm: pdfLetterheads.marginRightMm,
  createdByUserId: pdfLetterheads.createdByUserId,
  createdAt: pdfLetterheads.createdAt,
};

type LetterheadVersion = Omit<typeof pdfLetterheads.$inferSelect, 'image'>;

function toItem(row: LetterheadVersion, currentId: string | null, invoiceCount: number) {
  return { ...row, current: row.id === currentId, invoiceCount };
}

async function currentLetterheadId(): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, PDF_LETTERHEAD_KEY));
  return typeof row?.value === 'string' && row.value !== '' ? row.value : null;
}

async function invoiceCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ letterheadId: invoices.letterheadId, count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(isNotNull(invoices.letterheadId))
    .groupBy(invoices.letterheadId);
  return new Map(rows.map((row) => [String(row.letterheadId), row.count]));
}

async function sendNotFound(reply: FastifyReply): Promise<void> {
  await reply.status(404).send(LETTERHEAD_NOT_FOUND);
}

/**
 * The image of a body as stored, or the reason it is refused: the upload
 * checks (normalizePdfLetterheadImage), and the PDF generator must be able to
 * read it.
 */
function imageOf(
  value: string,
  layout: PdfLetterheadLayout,
): { dataUri: string; sha256: string } | { error: PdfLetterheadImageError } {
  const image = normalizePdfLetterheadImage(value);
  if ('error' in image) return image;
  const renders =
    letterheadBackground({ image: image.dataUri, imageSha256: image.sha256, layout }) != null;
  return renders ? image : { error: 'format' };
}

/** The layout of a body, normalized (normalizePdfLetterheadLayout), or null when invalid. */
function layoutOf(body: PdfLetterheadLayout): PdfLetterheadLayout | null {
  return normalizePdfLetterheadLayout({
    addressLeftMm: body.addressLeftMm,
    addressTopMm: body.addressTopMm,
    contentTopMm: body.contentTopMm,
    contentBottomMm: body.contentBottomMm,
    marginLeftMm: body.marginLeftMm,
    marginRightMm: body.marginRightMm,
  });
}

/** Audits a change of the current version in the settings history of pdf.letterhead. */
async function auditCurrent(
  request: FastifyRequest,
  before: string | null,
  after: string | null,
): Promise<void> {
  await writeAudit(
    { table: settingAuditLog, idColumn: 'setting_key' },
    {
      entityId: PDF_LETTERHEAD_KEY,
      entityIdSnapshot: PDF_LETTERHEAD_KEY,
      action: 'updated',
      ...getAuditActor(request),
      before: { key: PDF_LETTERHEAD_KEY, value: before ?? '' },
      after: { key: PDF_LETTERHEAD_KEY, value: after ?? '' },
    },
    db,
    request.log,
  );
}

/** Sets pdf.letterhead to the version id, or '' for none. */
async function writeCurrent(letterheadId: string | null): Promise<void> {
  const value = letterheadId ?? '';
  await db
    .insert(settings)
    .values({ key: PDF_LETTERHEAD_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export function pdfLetterheadRoutes(app: FastifyInstance): void {
  app.get(
    '/pdf-letterheads',
    {
      onRequest: [authorize('settings.system:read')],
      schema: {
        tags: ['Settings'],
        summary: 'List the PDF letterhead versions',
        description:
          'Every version of the PDF letterhead, newest first, without the image (GET /pdf-letterheads/:id/image): its layout in mm, whether it is current (pdf.letterhead) and how many invoices and credit notes were issued under it. A version never changes; a new image or layout is a new version. A user restricted to some sites gets 404 PDF_LETTERHEAD_NOT_FOUND: letterheads are company-wide.',
        operationId: 'listPdfLetterheads',
        security: [{ bearerAuth: [] }],
        response: {
          200: arrayResponse(letterheadItem),
          404: errorWith('Restricted to some sites', [ERROR_CODES.PDF_LETTERHEAD_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, LETTERHEAD_NOT_FOUND))) return;
      const rows = await db
        .select(versionColumns)
        .from(pdfLetterheads)
        .orderBy(desc(pdfLetterheads.createdAt));
      const currentId = await currentLetterheadId();
      const counts = await invoiceCounts();
      return rows.map((row) => toItem(row, currentId, counts.get(row.id) ?? 0));
    },
  );

  app.post(
    '/pdf-letterheads',
    {
      onRequest: [authorize('settings.system:write')],
      bodyLimit: UPLOAD_BODY_LIMIT,
      schema: {
        tags: ['Settings'],
        summary: 'Create a PDF letterhead version',
        description:
          'Stores a new version: the A4 image drawn as the background of the first page of invoices and credit notes, and the free areas in mm from the top left corner (the recipient address in the envelope window, the text of the first page from contentTopMm, the text of every page down to contentBottomMm, between the side margins). The PDF then leaves out the PDF logo, the seller block and the PDF footer (the letterhead carries them); later pages have no letterhead and a header with the seller, the document number and the page. With activate the version becomes current right away; otherwise set it with PUT /pdf-letterheads/current. An invalid image, layout or name answers 400 VALIDATION_ERROR. Audited in the settings history without the image.',
        operationId: 'createPdfLetterhead',
        security: [{ bearerAuth: [] }],
        body: zodSchema(createBody),
        response: {
          201: itemResponse(letterheadItem),
          400: errorWith('Invalid image, layout or name', [ERROR_CODES.VALIDATION_ERROR]),
          404: errorWith('Restricted to some sites', [ERROR_CODES.PDF_LETTERHEAD_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, LETTERHEAD_NOT_FOUND))) return;
      const body = request.body as z.infer<typeof createBody>;
      const name = normalizePdfLetterheadName(body.name);
      if (name == null) {
        await reply.status(400).send(INVALID_NAME);
        return;
      }
      const layout = layoutOf(body);
      if (layout == null) {
        await reply.status(400).send(INVALID_LAYOUT);
        return;
      }
      const image = imageOf(body.image, layout);
      if ('error' in image) {
        await reply
          .status(400)
          .send({ error: IMAGE_ERRORS[image.error], code: 'VALIDATION_ERROR' });
        return;
      }
      const actor = getAuditActor(request);
      const before = body.activate === true ? await currentLetterheadId() : null;
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(pdfLetterheads)
          .values({
            name,
            image: image.dataUri,
            imageSha256: image.sha256,
            ...layout,
            createdByUserId: actor.actorUserId,
          })
          .returning(versionColumns);
        if (row == null) throw new Error('Failed to create the PDF letterhead');
        if (body.activate === true) {
          await tx
            .insert(settings)
            .values({ key: PDF_LETTERHEAD_KEY, value: row.id })
            .onConflictDoUpdate({
              target: settings.key,
              set: { value: row.id, updatedAt: new Date() },
            });
        }
        return row;
      });
      const key = `pdfLetterhead:${created.id}`;
      await writeAudit(
        { table: settingAuditLog, idColumn: 'setting_key' },
        {
          entityId: key,
          entityIdSnapshot: key,
          action: 'created',
          ...actor,
          before: null,
          after: created,
        },
        db,
        request.log,
      );
      if (body.activate === true) await auditCurrent(request, before, created.id);
      await reply
        .status(201)
        .send(
          toItem(created, body.activate === true ? created.id : await currentLetterheadId(), 0),
        );
    },
  );

  app.get(
    '/pdf-letterheads/:id/image',
    {
      onRequest: [authorize('settings.system:read')],
      schema: {
        tags: ['Settings'],
        summary: 'Get the image of a PDF letterhead version',
        description:
          'The image of the version as stored (a PNG or sanitized SVG data URI). A user restricted to some sites gets 404 PDF_LETTERHEAD_NOT_FOUND.',
        operationId: 'getPdfLetterheadImage',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        response: {
          200: zodSchema(imageResponse),
          404: errorWith('PDF letterhead not found', [ERROR_CODES.PDF_LETTERHEAD_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, LETTERHEAD_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const [row] = await db
        .select({ image: pdfLetterheads.image })
        .from(pdfLetterheads)
        .where(eq(pdfLetterheads.id, id));
      if (row == null) return sendNotFound(reply);
      return { image: row.image };
    },
  );

  app.put(
    '/pdf-letterheads/current',
    {
      onRequest: [authorize('settings.system:write')],
      schema: {
        tags: ['Settings'],
        summary: 'Set the current PDF letterhead version',
        description:
          'Invoices and credit notes issued from now on keep this version (invoices.letterhead_id) and draw it; null issues them without a letterhead. Documents issued before keep the version they were issued under. An unknown version answers 404 PDF_LETTERHEAD_NOT_FOUND. Stored in the setting pdf.letterhead and audited in its settings history.',
        operationId: 'setCurrentPdfLetterhead',
        security: [{ bearerAuth: [] }],
        body: zodSchema(currentBody),
        response: {
          200: zodSchema(currentResponse),
          404: errorWith('PDF letterhead not found', [ERROR_CODES.PDF_LETTERHEAD_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, LETTERHEAD_NOT_FOUND))) return;
      const { letterheadId } = request.body as z.infer<typeof currentBody>;
      if (letterheadId != null) {
        const [row] = await db
          .select({ id: pdfLetterheads.id })
          .from(pdfLetterheads)
          .where(eq(pdfLetterheads.id, letterheadId));
        if (row == null) return sendNotFound(reply);
      }
      const before = await currentLetterheadId();
      await writeCurrent(letterheadId);
      if (before !== letterheadId) await auditCurrent(request, before, letterheadId);
      return { letterheadId };
    },
  );

  app.post(
    '/pdf-letterheads/preview',
    {
      onRequest: [authorize('settings.system:read')],
      bodyLimit: UPLOAD_BODY_LIMIT,
      schema: {
        tags: ['Settings'],
        summary: 'Preview a PDF letterhead',
        description:
          'Renders a sample invoice of two pages on the given image and layout, stored or not, with the company seller and payment details, so the address and the margins can be checked before a version is created. Nothing is stored. An invalid image or layout answers 400 VALIDATION_ERROR. Streams application/pdf.',
        operationId: 'previewPdfLetterhead',
        security: [{ bearerAuth: [] }],
        body: zodSchema(previewBody),
        response: {
          400: errorWith('Invalid image or layout', [ERROR_CODES.VALIDATION_ERROR]),
          404: errorWith('Restricted to some sites', [ERROR_CODES.PDF_LETTERHEAD_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, LETTERHEAD_NOT_FOUND))) return;
      const body = request.body as z.infer<typeof previewBody>;
      const layout = layoutOf(body);
      if (layout == null) {
        await reply.status(400).send(INVALID_LAYOUT);
        return;
      }
      const image = imageOf(body.image, layout);
      if ('error' in image) {
        await reply
          .status(400)
          .send({ error: IMAGE_ERRORS[image.error], code: 'VALIDATION_ERROR' });
        return;
      }
      const pdf = await generatePdfLetterheadPreview(
        { image: image.dataUri, imageSha256: image.sha256, layout },
        resolveInvoicePdfLanguage(body.language),
      );
      await reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="letterhead-preview.pdf"')
        .send(pdf);
    },
  );
}
