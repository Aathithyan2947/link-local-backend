import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import { ApiError } from '../../utils/ApiError.js';
import { prisma } from '../../lib/prisma.js';
import { upload, fileUrl } from '../../middleware/upload.js';
import * as service from './profiles.service.js';
import {
  contactSchema,
  customFieldsSchema,
  deliverySchema,
  educationSchema,
  familySchema,
  hobbySchema,
  paymentMethodSchema,
  paymentTermsSchema,
  productSchema,
  professionSchema,
  serviceTypesSchema,
  updateProfileSchema,
} from './profiles.schema.js';

export const profilesRouter = Router();
const auth = authenticate('user');

profilesRouter.get('/me', auth, asyncHandler(async (req, res) => ok(res, await service.getMyProfile(req.auth!.sub))));

// Resident vs Service Provider selection (after address, per PRD).
profilesRouter.patch(
  '/me/user-type',
  auth,
  validate({ body: z.object({ userType: z.enum(['resident', 'service_provider', 'business_listing']) }) }),
  asyncHandler(async (req, res) => {
    const u = await prisma.user.update({
      where: { id: req.auth!.sub },
      data: { userType: req.body.userType },
      select: { id: true, userType: true },
    });
    ok(res, u);
  }),
);

profilesRouter.patch(
  '/me',
  auth,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => ok(res, await service.updateProfile(req.auth!.sub, req.body))),
);

// Referral capture (at address verification): how they heard about us + who referred them.
profilesRouter.patch(
  '/me/referral',
  auth,
  validate({
    body: z.object({
      referralCode: z.string().optional(),
      referralSourceId: z.coerce.number().int().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.setReferral(req.auth!.sub, req.body))),
);

profilesRouter.post(
  '/me/photo',
  auth,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('photo file is required');
    ok(res, await service.setPhoto(req.auth!.sub, fileUrl(req.file.filename)));
  }),
);

profilesRouter.get(
  '/me/offer-help/suggest',
  auth,
  asyncHandler(async (req, res) => ok(res, await service.suggestOfferHelp(req.auth!.sub))),
);

// Education
profilesRouter.post('/me/education', auth, validate({ body: educationSchema }), asyncHandler(async (req, res) => ok(res, await service.addEducation(req.auth!.sub, req.body), 201)));
profilesRouter.delete('/me/education/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'profileEducation', Number(req.params.id)))));

// Profession
profilesRouter.post('/me/professions', auth, validate({ body: professionSchema }), asyncHandler(async (req, res) => ok(res, await service.addProfession(req.auth!.sub, req.body), 201)));
profilesRouter.delete('/me/professions/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'profileProfession', Number(req.params.id)))));

// Hobbies
profilesRouter.post('/me/hobbies', auth, validate({ body: hobbySchema }), asyncHandler(async (req, res) => ok(res, await service.addHobby(req.auth!.sub, req.body), 201)));
profilesRouter.delete('/me/hobbies/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'profileHobby', Number(req.params.id)))));

// Family
profilesRouter.post('/me/family', auth, validate({ body: familySchema }), asyncHandler(async (req, res) => ok(res, await service.addFamily(req.auth!.sub, req.body), 201)));
profilesRouter.delete('/me/family/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'profileFamily', Number(req.params.id)))));

// Pets (optional photo upload)
profilesRouter.post(
  '/me/pets',
  auth,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, string>;
    ok(
      res,
      await service.addPet(req.auth!.sub, {
        name: body.name,
        type: body.type,
        breed: body.breed,
        age: body.age ? Number(body.age) : undefined,
        photoUrl: req.file ? fileUrl(req.file.filename) : body.photoUrl,
      }),
      201,
    );
  }),
);
profilesRouter.delete('/me/pets/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'profilePet', Number(req.params.id)))));

// Contacts
profilesRouter.post('/me/contacts', auth, validate({ body: contactSchema }), asyncHandler(async (req, res) => ok(res, await service.addContact(req.auth!.sub, req.body), 201)));
profilesRouter.delete('/me/contacts/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'profileContactDetail', Number(req.params.id)))));

// Service types (SP)
profilesRouter.post('/me/service-types', auth, validate({ body: serviceTypesSchema }), asyncHandler(async (req, res) => ok(res, await service.setServiceTypes(req.auth!.sub, req.body))));

// Dynamic subcategory fields (SP) — incl. file uploads like menu/rate cards.
profilesRouter.get('/me/custom-fields', auth, asyncHandler(async (req, res) => ok(res, await service.getMyCustomFields(req.auth!.sub))));
profilesRouter.put('/me/custom-fields', auth, validate({ body: customFieldsSchema }), asyncHandler(async (req, res) => ok(res, await service.saveCustomFields(req.auth!.sub, req.body.values))));
profilesRouter.post(
  '/me/custom-fields/upload',
  auth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('file is required');
    ok(res, { url: fileUrl(req.file.filename) }, 201);
  }),
);

// Products (SP)
profilesRouter.post('/me/products', auth, validate({ body: productSchema }), asyncHandler(async (req, res) => ok(res, await service.addProduct(req.auth!.sub, req.body), 201)));
profilesRouter.delete('/me/products/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'spProduct', Number(req.params.id)))));

// Delivery + payment (SP)
profilesRouter.put('/me/delivery', auth, validate({ body: deliverySchema }), asyncHandler(async (req, res) => ok(res, await service.setDelivery(req.auth!.sub, req.body))));
profilesRouter.put('/me/payment-terms', auth, validate({ body: paymentTermsSchema }), asyncHandler(async (req, res) => ok(res, await service.setPaymentTerms(req.auth!.sub, req.body))));
profilesRouter.post('/me/payment-methods', auth, validate({ body: paymentMethodSchema }), asyncHandler(async (req, res) => ok(res, await service.addPaymentMethod(req.auth!.sub, req.body), 201)));
profilesRouter.delete('/me/payment-methods/:id', auth, asyncHandler(async (req, res) => ok(res, await service.deleteChild(req.auth!.sub, 'spPaymentMethod', Number(req.params.id)))));
