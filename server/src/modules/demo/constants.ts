import { SAMPLE_VARIANTS } from './variants.js';

/**
 * The built-in sample companies. They have fixed ids so they can be recognised
 * without relying on the user-settable `is_demo` flag, and so seeding stays
 * idempotent. The first is built straight from the demo workbooks; the others
 * are derived from them (see variants.ts).
 */
export const SAMPLE_COMPANY_ID = 'sample-company-arthsetu-demo';

export const SAMPLE_COMPANY_IDS: string[] = [SAMPLE_COMPANY_ID, ...SAMPLE_VARIANTS.map((v) => v.id)];

const SAMPLE_SET = new Set(SAMPLE_COMPANY_IDS);

export function isSampleCompany(id: string | null | undefined): boolean {
  return Boolean(id && SAMPLE_SET.has(id));
}

/**
 * Non-GET endpoints that only compute or record per-viewer state, and so stay
 * open on the read-only sample company. Everything else that writes is refused.
 */
const SAMPLE_ALLOWED_WRITES: RegExp[] = [
  /\/finance\/forecast\/scenario$/,
  /\/finance\/forecast\/runs$/,
  /\/finance\/ratios\/custom\/preview$/,
  /\/alerts\/[^/]+\/read$/,
  /\/alerts\/read-all$/,
  /\/alerts\/refresh$/,
];

export function isAllowedSampleWrite(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  return SAMPLE_ALLOWED_WRITES.some((re) => re.test(path));
}
