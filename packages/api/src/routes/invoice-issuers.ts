// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  db,
  fleets,
  invoiceIssuers,
  invoices,
  invoiceIssuerNumberCounters,
  pdfLetterheads,
  settingAuditLog,
  writeAudit,
} from '@evtivity/database';
import type { InvoiceIssuer } from '@evtivity/database';
import {
  MAX_INVOICE_NUMBER_DIGITS,
  MAX_INVOICE_NUMBER_PREFIX_LENGTH,
  MAX_INVOICE_NUMBER_START,
  MAX_PDF_FOOTER_LENGTH,
  MAX_PDF_FOOTER_LINES,
  MAX_PDF_LOGO_BYTES,
  INVOICE_NUMBER_PREFIX_PATTERN,
  normalizePdfFooter,
  normalizePdfLogo,
} from '@evtivity/lib';
import { zodSchema } from '../lib/zod-schema.js';
import { itemResponse, arrayResponse, errorWith } from '../lib/response-schemas.js';
import { ERROR_CODES } from '../lib/error-codes.generated.js';
import { requireAllSiteAccess } from '../lib/site-access.js';
import { authorize } from '../middleware/rbac.js';
import { getAuditActor } from '../lib/audit-actor.js';
import {
  UPLOAD_BODY_LIMIT as LETTERHEAD_UPLOAD_BODY_LIMIT,
  auditVersionCreated,
  checkVersionBody,
  createBody as createLetterheadBody,
  invoiceCounts,
  letterheadItem,
  toItem as letterheadToItem,
  versionColumns,
} from './pdf-letterheads.js';

// Company-wide configuration: a site-restricted user gets this 404 before any
// read or write (requireAllSiteAccess, features/site-access-control.md).
const ISSUER_NOT_FOUND = {
  error: 'Invoice issuer not found',
  code: 'INVOICE_ISSUER_NOT_FOUND',
} as const;

const INVALID_PDF_FOOTER = {
  error: `pdfFooter must be plain text of at most ${String(MAX_PDF_FOOTER_LENGTH)} characters and ${String(MAX_PDF_FOOTER_LINES)} lines`,
  code: 'VALIDATION_ERROR',
} as const;

const INVALID_PDF_LOGO = {
  error: `logo must be a PNG or SVG data URI of at most ${String(MAX_PDF_LOGO_BYTES / 1024)} KB`,
  code: 'VALIDATION_ERROR',
} as const;

const optionalText = (max: number, description: string) =>
  z.string().max(max).nullable().optional().describe(description);

const prefixSchema = z
  .string()
  .max(MAX_INVOICE_NUMBER_PREFIX_LENGTH)
  .regex(INVOICE_NUMBER_PREFIX_PATTERN, 'Letters, digits and - . _ only');
const startSchema = z.number().int().min(0).max(MAX_INVOICE_NUMBER_START);
const digitsSchema = z.number().int().min(0).max(MAX_INVOICE_NUMBER_DIGITS);

const issuerFields = {
  name: z
    .string()
    .max(255)
    .regex(/\S/, 'Must not be blank')
    .describe('Seller name printed on the invoice'),
  street: optionalText(255, 'Street address'),
  zip: optionalText(20, 'Postal code'),
  city: optionalText(100, 'City'),
  state: optionalText(100, 'State or region'),
  country: optionalText(100, 'Country'),
  taxId: optionalText(64, 'Tax or VAT number'),
  taxIdLabel: optionalText(40, 'Label printed before the tax ID; empty: the localized "Tax ID"'),
  registrationNumber: optionalText(100, 'Company registration number'),
  email: z.email().max(254).nullable().optional().describe('Contact email printed on invoices'),
  phone: optionalText(40, 'Contact phone printed on invoices'),
  invoicePrefix: prefixSchema.optional().describe('Invoice number prefix; may be empty'),
  invoiceWithYear: z
    .boolean()
    .optional()
    .describe(
      'Invoice numbers carry the two-digit year after the prefix; the counter restarts yearly',
    ),
  invoiceStart: startSchema.optional().describe('First invoice number (of each year with year)'),
  invoiceDigits: digitsSchema.optional().describe('Minimum invoice number length, zero padded'),
  creditNotePrefix: prefixSchema.optional().describe('Credit note number prefix; may be empty'),
  creditNoteWithYear: z
    .boolean()
    .optional()
    .describe('Credit note numbers carry the two-digit year; the counter restarts yearly'),
  creditNoteStart: startSchema
    .optional()
    .describe('First credit note number (of each year with year)'),
  creditNoteDigits: digitsSchema.optional().describe('Minimum credit note number length'),
  pdfFooter: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Footer of the issuer's PDFs: null takes the company's (pdf.footer), an empty string draws none",
    ),
};

const createIssuerBody = z.object(issuerFields);
const updateIssuerBody = z.object({ ...issuerFields, name: issuerFields.name.optional() });

const issuerItem = z
  .object({
    id: z.string().describe('Invoice issuer identifier'),
    name: z.string().describe('Seller name'),
    street: z.string().nullable(),
    zip: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    taxId: z.string().nullable(),
    taxIdLabel: z.string().nullable(),
    registrationNumber: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    invoicePrefix: z.string(),
    invoiceWithYear: z.boolean(),
    invoiceStart: z.number(),
    invoiceDigits: z.number(),
    creditNotePrefix: z.string(),
    creditNoteWithYear: z.boolean(),
    creditNoteStart: z.number(),
    creditNoteDigits: z.number(),
    pdfFooter: z
      .string()
      .nullable()
      .describe("Footer of the issuer's PDFs; null: the company's, empty: none"),
    hasPdfLogo: z
      .boolean()
      .describe("The issuer has its own PDF logo; otherwise its PDFs show the company's"),
    letterheadId: z
      .string()
      .nullable()
      .describe(
        "The current version of the issuer's own PDF letterhead; null: the company's (pdf.letterhead)",
      ),
    invoiceNumberLocked: z
      .boolean()
      .describe('An invoice was issued: the invoice number format can no longer change'),
    creditNoteNumberLocked: z
      .boolean()
      .describe('A credit note was issued: the credit note number format can no longer change'),
    fleetCount: z.number().describe('Fleets whose invoices are issued under this issuer'),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .loose();

const idParams = z.object({ id: z.string().describe('Invoice issuer identifier') });

const pdfLogoBody = z.object({
  logo: z.string().describe('PNG or SVG data URI of at most 512 KB; an SVG is stored sanitized'),
});
const pdfLogoResponse = z.object({
  logo: z.string().nullable().describe("The issuer's logo data URI; null: the company's"),
});
const letterheadBody = z.object({
  letterheadId: z
    .string()
    .nullable()
    .describe(
      "A version of the issuer's own letterhead its new documents keep; null takes the company letterhead",
    ),
});

const INVOICE_FORMAT_KEYS = [
  'invoicePrefix',
  'invoiceWithYear',
  'invoiceStart',
  'invoiceDigits',
] as const;
const CREDIT_NOTE_FORMAT_KEYS = [
  'creditNotePrefix',
  'creditNoteWithYear',
  'creditNoteStart',
  'creditNoteDigits',
] as const;

type Executor = Pick<typeof db, 'select' | 'selectDistinct'>;

/** The kinds whose number range the issuer has used: those formats are locked. */
async function lockedKinds(executor: Executor, issuerId: string): Promise<Set<string>> {
  const rows = await executor
    .selectDistinct({ kind: invoiceIssuerNumberCounters.kind })
    .from(invoiceIssuerNumberCounters)
    .where(eq(invoiceIssuerNumberCounters.issuerId, issuerId));
  return new Set(rows.map((row) => row.kind));
}

async function fleetCounts(executor: Executor): Promise<Map<string, number>> {
  const rows = await executor
    .select({ issuerId: fleets.invoiceIssuerId, count: sql<number>`count(*)::int` })
    .from(fleets)
    .where(sql`${fleets.invoiceIssuerId} IS NOT NULL`)
    .groupBy(fleets.invoiceIssuerId);
  return new Map(rows.map((row) => [String(row.issuerId), row.count]));
}

/**
 * The issuer without its logo bytes (up to 512 KB): lists, responses and the
 * audit trail say whether it has one, GET .../pdf-logo returns it.
 */
function withoutLogo(issuer: InvoiceIssuer): Omit<InvoiceIssuer, 'pdfLogo'> & {
  hasPdfLogo: boolean;
} {
  const { pdfLogo, ...rest } = issuer;
  return { ...rest, hasPdfLogo: pdfLogo != null };
}

async function toItem(executor: Executor, issuer: InvoiceIssuer, fleetCount: number) {
  const locked = await lockedKinds(executor, issuer.id);
  return {
    ...withoutLogo(issuer),
    invoiceNumberLocked: locked.has('invoice'),
    creditNoteNumberLocked: locked.has('credit_note'),
    fleetCount,
  };
}

/** The optional seller details: a blank value is stored as null. */
const NULLABLE_TEXT_KEYS = new Set([
  'street',
  'zip',
  'city',
  'state',
  'country',
  'taxId',
  'taxIdLabel',
  'registrationNumber',
  'email',
  'phone',
]);

/**
 * The body as stored: the name and seller details trimmed, a blank detail as
 * null, the footer normalized (normalizePdfFooter). Null when the footer is
 * not a valid footer.
 */
function normalized<T extends Record<string, unknown>>(body: T): T | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'pdfFooter' && typeof value === 'string') {
      const footer = normalizePdfFooter(value);
      if (footer == null) return null;
      out[key] = footer;
    } else if (typeof value === 'string' && (key === 'name' || NULLABLE_TEXT_KEYS.has(key))) {
      const trimmed = value.trim();
      out[key] = trimmed === '' && key !== 'name' ? null : trimmed;
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Audits a change of an issuer in the settings history (setting_audit_log under
 * the key invoiceIssuer:<id>): issuers are company settings. A create is an
 * update from nothing.
 */
async function auditIssuer(
  request: FastifyRequest,
  issuerId: string,
  change: {
    action: 'updated' | 'deleted';
    before: InvoiceIssuer | null;
    after: InvoiceIssuer | null;
    notes?: string;
  },
): Promise<void> {
  const key = `invoiceIssuer:${issuerId}`;
  await writeAudit(
    { table: settingAuditLog, idColumn: 'setting_key' },
    {
      entityId: key,
      entityIdSnapshot: key,
      action: change.action,
      ...getAuditActor(request),
      before: change.before != null ? withoutLogo(change.before) : null,
      after: change.after != null ? withoutLogo(change.after) : null,
      ...(change.notes != null ? { notes: change.notes } : {}),
    },
    db,
    request.log,
  );
}

async function sendNotFound(reply: FastifyReply): Promise<void> {
  await reply.status(404).send(ISSUER_NOT_FOUND);
}

/**
 * Sets (a data URI) or removes (null) the issuer's logo. Null when the issuer
 * does not exist; the caller audits the change.
 */
async function updatePdfLogo(
  id: string,
  logo: string | null,
): Promise<{ before: InvoiceIssuer; after: InvoiceIssuer; item: unknown } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(invoiceIssuers)
      .where(eq(invoiceIssuers.id, id))
      .for('update');
    if (current == null) return null;
    const [updated] = await tx
      .update(invoiceIssuers)
      .set({ pdfLogo: logo, updatedAt: new Date() })
      .where(eq(invoiceIssuers.id, id))
      .returning();
    const counts = await fleetCounts(tx);
    const after = updated ?? current;
    return { before: current, after, item: await toItem(tx, after, counts.get(id) ?? 0) };
  });
}

export function invoiceIssuerRoutes(app: FastifyInstance): void {
  app.get(
    '/invoice-issuers',
    {
      onRequest: [authorize('settings.system:read')],
      schema: {
        tags: ['Invoices'],
        summary: 'List the invoice issuers',
        description:
          'The sellers other than the company that fleet invoices can be issued under, each with its number ranges for invoices and credit notes, whether a range is already in use (its format is then locked) and how many fleets use the issuer. A user restricted to some sites gets 404 INVOICE_ISSUER_NOT_FOUND: issuers are company-wide.',
        operationId: 'listInvoiceIssuers',
        security: [{ bearerAuth: [] }],
        response: {
          200: arrayResponse(issuerItem),
          404: errorWith('Restricted to some sites', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const issuers = await db.select().from(invoiceIssuers).orderBy(asc(invoiceIssuers.name));
      const counts = await fleetCounts(db);
      return Promise.all(issuers.map((issuer) => toItem(db, issuer, counts.get(issuer.id) ?? 0)));
    },
  );

  app.post(
    '/invoice-issuers',
    {
      onRequest: [authorize('settings.system:write')],
      schema: {
        tags: ['Invoices'],
        summary: 'Create an invoice issuer',
        description:
          'Creates a seller with its number ranges. Number format: the prefix (letters, digits and - . _, may be empty), the two-digit year right after the prefix, without a separator (the counter then restarts each year), the start value and the minimum length. Defaults: empty prefix, no year, start 1, no padding. pdfFooter (null by default) is the footer of its PDFs: null takes the company footer (pdf.footer), an empty string draws none; an invalid footer answers 400 VALIDATION_ERROR. The logo is set with PUT /invoice-issuers/:id/pdf-logo. A fleet uses it through its billing profile (invoiceIssuerId).',
        operationId: 'createInvoiceIssuer',
        security: [{ bearerAuth: [] }],
        body: zodSchema(createIssuerBody),
        response: {
          201: itemResponse(issuerItem),
          400: errorWith('Invalid PDF footer', [ERROR_CODES.VALIDATION_ERROR]),
          404: errorWith('Restricted to some sites', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const body = normalized(request.body as z.infer<typeof createIssuerBody>);
      if (body == null) {
        await reply.status(400).send(INVALID_PDF_FOOTER);
        return;
      }
      const [issuer] = await db.insert(invoiceIssuers).values(body).returning();
      if (issuer == null) throw new Error('Failed to create the invoice issuer');
      await auditIssuer(request, issuer.id, {
        action: 'updated',
        before: null,
        after: issuer,
        notes: 'Invoice issuer created',
      });
      await reply.status(201).send(await toItem(db, issuer, 0));
    },
  );

  app.patch(
    '/invoice-issuers/:id',
    {
      onRequest: [authorize('settings.system:write')],
      schema: {
        tags: ['Invoices'],
        summary: 'Update an invoice issuer',
        description:
          'Fields left out keep their value; null or a blank string clears a text field (pdfFooter: null takes the company footer, an empty string draws none). The seller details and the footer apply to documents issued afterwards: an issued document keeps the seller it was issued with. A number format (prefix, year, start, length) can no longer change once the issuer has issued a document of that kind: 409 INVOICE_ISSUER_NUMBER_FORMAT_LOCKED. The issuer row is locked for the update, so a document being issued is numbered with the format it read.',
        operationId: 'updateInvoiceIssuer',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        body: zodSchema(updateIssuerBody),
        response: {
          200: itemResponse(issuerItem),
          400: errorWith('Invalid PDF footer', [ERROR_CODES.VALIDATION_ERROR]),
          404: errorWith('Invoice issuer not found', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
          409: errorWith('The number format is in use', [
            ERROR_CODES.INVOICE_ISSUER_NUMBER_FORMAT_LOCKED,
          ]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const body = normalized(request.body as z.infer<typeof updateIssuerBody>);
      if (body == null) {
        await reply.status(400).send(INVALID_PDF_FOOTER);
        return;
      }
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(invoiceIssuers)
          .where(eq(invoiceIssuers.id, id))
          .for('update');
        if (current == null) return { kind: 'not_found' as const };
        const locked = await lockedKinds(tx, id);
        const changes = (keys: readonly (keyof typeof body & keyof InvoiceIssuer)[]): boolean =>
          keys.some((key) => body[key] !== undefined && body[key] !== current[key]);
        if (
          (locked.has('invoice') && changes(INVOICE_FORMAT_KEYS)) ||
          (locked.has('credit_note') && changes(CREDIT_NOTE_FORMAT_KEYS))
        ) {
          return { kind: 'locked' as const };
        }
        const [updated] = await tx
          .update(invoiceIssuers)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(invoiceIssuers.id, id))
          .returning();
        const counts = await fleetCounts(tx);
        return {
          kind: 'ok' as const,
          item: await toItem(tx, updated ?? current, counts.get(id) ?? 0),
          before: current,
          after: updated ?? current,
        };
      });
      if (result.kind === 'not_found') return sendNotFound(reply);
      if (result.kind === 'locked') {
        await reply.status(409).send({
          error:
            'The number format cannot change once the issuer has issued a document of that kind',
          code: 'INVOICE_ISSUER_NUMBER_FORMAT_LOCKED',
        });
        return;
      }
      await auditIssuer(request, id, {
        action: 'updated',
        before: result.before,
        after: result.after,
      });
      return result.item;
    },
  );

  app.get(
    '/invoice-issuers/:id/pdf-logo',
    {
      onRequest: [authorize('settings.system:read')],
      schema: {
        tags: ['Invoices'],
        summary: "Get an invoice issuer's PDF logo",
        description:
          "The logo the issuer's invoices and credit notes draw, as stored (a PNG, JPEG or SVG data URI), or null when its PDFs draw the company logo (pdf.logo). A user restricted to some sites gets 404 INVOICE_ISSUER_NOT_FOUND.",
        operationId: 'getInvoiceIssuerPdfLogo',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        response: {
          200: zodSchema(pdfLogoResponse),
          404: errorWith('Invoice issuer not found', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const [row] = await db
        .select({ logo: invoiceIssuers.pdfLogo })
        .from(invoiceIssuers)
        .where(eq(invoiceIssuers.id, id));
      if (row == null) return sendNotFound(reply);
      return { logo: row.logo };
    },
  );

  app.put(
    '/invoice-issuers/:id/pdf-logo',
    {
      onRequest: [authorize('settings.system:write')],
      schema: {
        tags: ['Invoices'],
        summary: "Set an invoice issuer's PDF logo",
        description:
          "Sets the logo the issuer's invoices and credit notes draw instead of the company logo, from the next PDF on (also of documents issued before, as the company logo). A PNG or SVG data URI of at most 512 KB; an SVG is stored sanitized. Anything else answers 400 VALIDATION_ERROR. Audited in the settings history without the image.",
        operationId: 'setInvoiceIssuerPdfLogo',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        body: zodSchema(pdfLogoBody),
        response: {
          200: itemResponse(issuerItem),
          400: errorWith('Invalid logo', [ERROR_CODES.VALIDATION_ERROR]),
          404: errorWith('Invoice issuer not found', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const { logo } = request.body as z.infer<typeof pdfLogoBody>;
      const stored = normalizePdfLogo(logo);
      if (stored == null || stored === '') {
        await reply.status(400).send(INVALID_PDF_LOGO);
        return;
      }
      const result = await updatePdfLogo(id, stored);
      if (result == null) return sendNotFound(reply);
      await auditIssuer(request, id, {
        action: 'updated',
        before: result.before,
        after: result.after,
        notes: 'PDF logo set',
      });
      return result.item;
    },
  );

  app.delete(
    '/invoice-issuers/:id/pdf-logo',
    {
      onRequest: [authorize('settings.system:write')],
      schema: {
        tags: ['Invoices'],
        summary: "Remove an invoice issuer's PDF logo",
        description:
          "The issuer's invoices and credit notes draw the company logo (pdf.logo) again, from the next PDF on. Audited in the settings history.",
        operationId: 'deleteInvoiceIssuerPdfLogo',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        response: {
          200: itemResponse(issuerItem),
          404: errorWith('Invoice issuer not found', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const result = await updatePdfLogo(id, null);
      if (result == null) return sendNotFound(reply);
      await auditIssuer(request, id, {
        action: 'updated',
        before: result.before,
        after: result.after,
        notes: 'PDF logo removed',
      });
      return result.item;
    },
  );

  app.get(
    '/invoice-issuers/:id/letterheads',
    {
      onRequest: [authorize('settings.system:read')],
      schema: {
        tags: ['Invoices'],
        summary: "List an invoice issuer's PDF letterhead versions",
        description:
          "The issuer's own letterhead versions, newest first, without the image (GET /pdf-letterheads/:id/image), each with its layout, whether it is the issuer's current version and how many documents were issued under it. Without a current version the issuer's documents take the company letterhead (pdf.letterhead). A user restricted to some sites gets 404 INVOICE_ISSUER_NOT_FOUND.",
        operationId: 'listInvoiceIssuerLetterheads',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        response: {
          200: arrayResponse(letterheadItem),
          404: errorWith('Invoice issuer not found', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const [issuer] = await db
        .select({ letterheadId: invoiceIssuers.letterheadId })
        .from(invoiceIssuers)
        .where(eq(invoiceIssuers.id, id));
      if (issuer == null) return sendNotFound(reply);
      const rows = await db
        .select(versionColumns)
        .from(pdfLetterheads)
        .where(eq(pdfLetterheads.issuerId, id))
        .orderBy(desc(pdfLetterheads.createdAt));
      const counts = await invoiceCounts();
      return rows.map((row) => letterheadToItem(row, issuer.letterheadId, counts.get(row.id) ?? 0));
    },
  );

  app.post(
    '/invoice-issuers/:id/letterheads',
    {
      onRequest: [authorize('settings.system:write')],
      bodyLimit: LETTERHEAD_UPLOAD_BODY_LIMIT,
      schema: {
        tags: ['Invoices'],
        summary: 'Create a PDF letterhead version of an invoice issuer',
        description:
          "Stores a new version of the issuer's own letterhead, with the same image and layout rules as POST /pdf-letterheads (preview it with POST /pdf-letterheads/preview and issuerId). With activate it becomes the issuer's current version right away; otherwise set it with PUT /invoice-issuers/:id/letterhead. The issuer's invoices and credit notes keep the version current at their issue and then draw neither the PDF logo nor the PDF footer. An invalid image, layout or name answers 400 VALIDATION_ERROR. Audited in the settings history without the image.",
        operationId: 'createInvoiceIssuerLetterhead',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        body: zodSchema(createLetterheadBody),
        response: {
          201: itemResponse(letterheadItem),
          400: errorWith('Invalid image, layout or name', [ERROR_CODES.VALIDATION_ERROR]),
          404: errorWith('Invoice issuer not found', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const body = request.body as z.infer<typeof createLetterheadBody>;
      const checked = checkVersionBody(body);
      if ('invalid' in checked) {
        await reply.status(400).send(checked.invalid);
        return;
      }
      const { name, layout, image } = checked;
      const actorUserId = getAuditActor(request).actorUserId;
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(invoiceIssuers)
          .where(eq(invoiceIssuers.id, id))
          .for('update');
        if (current == null) return null;
        const [created] = await tx
          .insert(pdfLetterheads)
          .values({
            name,
            image: image.dataUri,
            imageSha256: image.sha256,
            ...layout,
            issuerId: id,
            createdByUserId: actorUserId,
          })
          .returning(versionColumns);
        if (created == null) throw new Error('Failed to create the PDF letterhead');
        if (body.activate !== true) return { created, current, updated: null };
        const [updated] = await tx
          .update(invoiceIssuers)
          .set({ letterheadId: created.id, updatedAt: new Date() })
          .where(eq(invoiceIssuers.id, id))
          .returning();
        return { created, current, updated: updated ?? null };
      });
      if (result == null) return sendNotFound(reply);
      await auditVersionCreated(request, result.created);
      if (result.updated != null) {
        await auditIssuer(request, id, {
          action: 'updated',
          before: result.current,
          after: result.updated,
          notes: 'PDF letterhead set',
        });
      }
      const currentId = (result.updated ?? result.current).letterheadId;
      await reply.status(201).send(letterheadToItem(result.created, currentId, 0));
    },
  );

  app.put(
    '/invoice-issuers/:id/letterhead',
    {
      onRequest: [authorize('settings.system:write')],
      schema: {
        tags: ['Invoices'],
        summary: "Set an invoice issuer's current PDF letterhead version",
        description:
          "The issuer's invoices and credit notes issued from now on keep this version of its own letterhead (invoices.letterhead_id); null makes them take the company letterhead (pdf.letterhead) again. Documents issued before keep their version. A version that is not the issuer's answers 404 PDF_LETTERHEAD_NOT_FOUND. Audited in the settings history.",
        operationId: 'setInvoiceIssuerLetterhead',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        body: zodSchema(letterheadBody),
        response: {
          200: itemResponse(issuerItem),
          404: errorWith('Invoice issuer or PDF letterhead not found', [
            ERROR_CODES.INVOICE_ISSUER_NOT_FOUND,
            ERROR_CODES.PDF_LETTERHEAD_NOT_FOUND,
          ]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const { letterheadId } = request.body as z.infer<typeof letterheadBody>;
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(invoiceIssuers)
          .where(eq(invoiceIssuers.id, id))
          .for('update');
        if (current == null) return { kind: 'issuer_not_found' as const };
        if (letterheadId != null) {
          const [version] = await tx
            .select({ id: pdfLetterheads.id })
            .from(pdfLetterheads)
            .where(and(eq(pdfLetterheads.id, letterheadId), eq(pdfLetterheads.issuerId, id)));
          if (version == null) return { kind: 'letterhead_not_found' as const };
        }
        const [updated] = await tx
          .update(invoiceIssuers)
          .set({ letterheadId, updatedAt: new Date() })
          .where(eq(invoiceIssuers.id, id))
          .returning();
        const counts = await fleetCounts(tx);
        const after = updated ?? current;
        return {
          kind: 'updated' as const,
          before: current,
          after,
          item: await toItem(tx, after, counts.get(id) ?? 0),
        };
      });
      if (result.kind === 'issuer_not_found') return sendNotFound(reply);
      if (result.kind === 'letterhead_not_found') {
        await reply
          .status(404)
          .send({ error: 'PDF letterhead not found', code: 'PDF_LETTERHEAD_NOT_FOUND' });
        return;
      }
      if (result.before.letterheadId !== letterheadId) {
        await auditIssuer(request, id, {
          action: 'updated',
          before: result.before,
          after: result.after,
          notes: letterheadId != null ? 'PDF letterhead set' : 'PDF letterhead removed',
        });
      }
      return result.item;
    },
  );

  app.delete(
    '/invoice-issuers/:id',
    {
      onRequest: [authorize('settings.system:write')],
      schema: {
        tags: ['Invoices'],
        summary: 'Delete an invoice issuer',
        description:
          'Deletes an issuer that no fleet uses and that never issued a document, with its own letterhead versions; otherwise 409 INVOICE_ISSUER_IN_USE.',
        operationId: 'deleteInvoiceIssuer',
        security: [{ bearerAuth: [] }],
        params: zodSchema(idParams),
        response: {
          204: { type: 'null' as const },
          404: errorWith('Invoice issuer not found', [ERROR_CODES.INVOICE_ISSUER_NOT_FOUND]),
          409: errorWith('The issuer is in use', [ERROR_CODES.INVOICE_ISSUER_IN_USE]),
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAllSiteAccess(request, reply, ISSUER_NOT_FOUND))) return;
      const { id } = request.params as z.infer<typeof idParams>;
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(invoiceIssuers)
          .where(eq(invoiceIssuers.id, id))
          .for('update');
        if (current == null) return { kind: 'not_found' as const };
        const [fleet] = await tx
          .select({ id: fleets.id })
          .from(fleets)
          .where(eq(fleets.invoiceIssuerId, id))
          .limit(1);
        const [invoice] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.issuerId, id))
          .limit(1);
        if (fleet != null || invoice != null || (await lockedKinds(tx, id)).size > 0) {
          return { kind: 'in_use' as const };
        }
        // Its own letterhead versions go with it: it never issued a document,
        // so no document keeps one of them.
        if (current.letterheadId != null) {
          await tx
            .update(invoiceIssuers)
            .set({ letterheadId: null })
            .where(eq(invoiceIssuers.id, id));
        }
        await tx.delete(pdfLetterheads).where(eq(pdfLetterheads.issuerId, id));
        await tx.delete(invoiceIssuers).where(eq(invoiceIssuers.id, id));
        return { kind: 'deleted' as const, before: current };
      });
      if (result.kind === 'not_found') return sendNotFound(reply);
      if (result.kind === 'in_use') {
        await reply.status(409).send({
          error: 'The invoice issuer is used by a fleet or an invoice',
          code: 'INVOICE_ISSUER_IN_USE',
        });
        return;
      }
      await auditIssuer(request, id, { action: 'deleted', before: result.before, after: null });
      await reply.status(204).send();
    },
  );
}
