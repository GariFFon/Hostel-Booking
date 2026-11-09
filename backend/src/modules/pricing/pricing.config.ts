import { env } from '@/core/config/env';
import type { TaxPolicy } from './pricing.engine';

export const taxPolicy = (): TaxPolicy => ({ lowBps: env().GST_LOW_BPS, highBps: env().GST_HIGH_BPS, thresholdPaise: env().GST_THRESHOLD_PAISE });
