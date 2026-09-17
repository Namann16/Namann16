import { Router } from 'express';
import { settingsSchema } from '../validation/schemas.js';
import { asyncHandler } from '../middleware/errors.js';
import { getUserSettings, updateUserSettings } from '../services/repository.js';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getUserSettings() });
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    res.json({ settings: await updateUserSettings(body) });
  }),
);
