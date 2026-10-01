import { Router } from 'express';
import { AVAILABILITY_VALUES, availabilityLabel } from '../lib/availability';
import { BUSINESS_CATEGORIES } from '../lib/categories';
import { ORDER_STATUSES, statusLabel } from '../lib/orderStatus';
import { REVIEW_TAGS } from '../lib/reviews';

export function metaRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      categories: BUSINESS_CATEGORIES.map((category) => ({
        id: category.id,
        slug: category.slug,
        label: category.label,
      })),
      availability: AVAILABILITY_VALUES.map((value) => ({ id: value, label: availabilityLabel(value) })),
      orderStatuses: ORDER_STATUSES.map((status) => ({ id: status, label: statusLabel(status) })),
      reviewTags: REVIEW_TAGS,
      languages: [
        { code: 'en', label: 'English' },
        { code: 'bn', label: 'বাংলা' },
        { code: 'hi', label: 'हिन्दी' },
      ],
    });
  });

  return router;
}
