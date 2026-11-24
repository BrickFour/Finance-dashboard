/**
 * The built-in sample company. It has a fixed id so it can be recognised without
 * relying on the user-settable `is_demo` flag, and so seeding stays idempotent.
 */
export const SAMPLE_COMPANY_ID = 'sample-company-arthsetu-demo';

export function isSampleCompany(id: string | null | undefined): boolean {
  return id === SAMPLE_COMPANY_ID;
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
