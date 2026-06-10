import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { ApiError } from '../../utils/ApiError.js';
import { upload, fileUrl } from '../../middleware/upload.js';
import * as service from './addresses.service.js';
import { recomputeCompletion } from '../profiles/profiles.service.js';
import { writeAudit } from '../admin/audit.js';
import {
  createAddressSchema,
  listAddressesSchema,
  listAddressDocsSchema,
  setActiveSchema,
  cityFieldsSchema,
} from './addresses.schema.js';

export const addressesRouter = Router();

// In-memory upload for spreadsheet imports (.xlsx / .csv).
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ── Directory autocomplete (app) ─────────────────────────────
addressesRouter.get(
  '/directory',
  authenticate('user'),
  validate({ query: z.object({ q: z.string().default('') }) }),
  asyncHandler(async (req, res) => {
    const { q } = getValidatedQuery<{ q: string }>(req);
    ok(res, await service.searchDirectory(q));
  }),
);

// Per-city address-form config the app uses to render the address form (visible only).
addressesRouter.get(
  '/city-fields/:cityId',
  authenticate('user'),
  asyncHandler(async (req, res) => {
    const fields = await service.getCityAddressFields(Number(req.params.cityId));
    ok(res, fields.filter((f) => f.isVisible));
  }),
);

// ── User-facing ──────────────────────────────────────────────
addressesRouter.post(
  '/',
  authenticate('user'),
  validate({ body: createAddressSchema }),
  asyncHandler(async (req, res) => {
    const address = await service.createAddressForUser(req.auth!.sub, req.body);
    ok(res, address, 201);
  }),
);

addressesRouter.get(
  '/me',
  authenticate('user'),
  asyncHandler(async (req, res) => {
    ok(res, await service.getMyAddress(req.auth!.sub));
  }),
);

addressesRouter.post(
  '/documents',
  authenticate('user'),
  upload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('document file is required');
    const docType = (req.body.docType as string) || 'other';
    const doc = await service.addVerificationDoc({
      userId: req.auth!.sub,
      docType,
      docUrl: fileUrl(req.file.filename),
    });
    ok(res, doc, 201);
  }),
);

// ── Admin "Address Capture" ──────────────────────────────────
addressesRouter.get(
  '/admin/list',
  authenticate('admin'),
  validate({ query: listAddressesSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<{
      page: number;
      pageSize: number;
      q?: string;
      status?: string;
    }>(req);
    const { items, meta } = await service.listAddresses(query);
    paginated(res, items, meta);
  }),
);

// Toggle an address Active/Inactive
addressesRouter.patch(
  '/admin/:id',
  authenticate('admin'),
  validate({ body: setActiveSchema }),
  asyncHandler(async (req, res) => {
    const updated = await service.setAddressActive(Number(req.params.id), req.body.isActive);
    await writeAudit(req.auth!.sub, updated.isActive ? 'activate_address' : 'deactivate_address', 'address', updated.id);
    ok(res, updated);
  }),
);

// Bulk import addresses from an Excel/CSV sheet
addressesRouter.post(
  '/admin/import',
  authenticate('admin'),
  sheetUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Spreadsheet file is required (field "file")');
    let rows: Array<Record<string, unknown>>;
    try {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    } catch {
      throw ApiError.badRequest('Could not parse the spreadsheet');
    }
    const result = await service.importAddresses(rows);
    await writeAudit(req.auth!.sub, 'import_addresses', 'address', undefined, result);
    ok(res, result, 201);
  }),
);

// Per-city address-form configuration (admin)
addressesRouter.get(
  '/admin/city-fields/:cityId',
  authenticate('admin'),
  asyncHandler(async (req, res) => {
    ok(res, await service.getCityAddressFields(Number(req.params.cityId)));
  }),
);

addressesRouter.put(
  '/admin/city-fields/:cityId',
  authenticate('admin'),
  validate({ body: cityFieldsSchema }),
  asyncHandler(async (req, res) => {
    const fields = await service.saveCityAddressFields(Number(req.params.cityId), req.body.fields);
    await writeAudit(req.auth!.sub, 'save_city_address_fields', 'city', Number(req.params.cityId));
    ok(res, fields);
  }),
);

// Address-proof review queue
addressesRouter.get(
  '/admin/docs',
  authenticate('admin'),
  validate({ query: listAddressDocsSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<{ page: number; pageSize: number; status?: string }>(req);
    const { items, meta } = await service.listAddressDocs(query);
    paginated(res, items, meta);
  }),
);

addressesRouter.patch(
  '/admin/docs/:id',
  authenticate('admin'),
  validate({ body: z.object({ status: z.enum(['approved', 'rejected']) }) }),
  asyncHandler(async (req, res) => {
    const doc = await service.reviewAddressDoc(Number(req.params.id), req.body.status, req.auth!.sub);
    // Approving a proof affects the owner's profile completeness.
    for (const p of doc.address.profiles) await recomputeCompletion(p.id);
    await writeAudit(req.auth!.sub, `${req.body.status}_address_doc`, 'address_doc', doc.id);
    ok(res, { id: doc.id, status: doc.status });
  }),
);

export default addressesRouter;
