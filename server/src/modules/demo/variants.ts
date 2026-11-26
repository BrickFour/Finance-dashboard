import XLSX from 'xlsx';
import type { WorkbookFile } from '../imports/bulk.js';

/**
 * Additional sample companies, each derived from the bundled demo workbooks.
 *
 * Every name a reader sees (company, customers, suppliers, vendors, branches,
 * stock items) is replaced, and the amounts are scaled so each company has its
 * own size and margins. The books stay internally consistent: every voucher and
 * the opening trial balance still balance to the rupee, outstanding amounts are
 * recomputed, and an expense row moves with the payment voucher it records.
 */
export interface SampleVariant {
  id: string;
  name: string;
  legalName: string;
  gstin: string;
  pan: string;
  address: string;
  /** Multiplies every amount. */
  scale: number;
  /** Extra multiplier for operating expenses, which moves the profit margin. */
  costFactor: number;
  /** Rupees of share capital paid into the main bank account at the start of the year (sets the cash outlook). */
  capitalInjection: number;
  /** Original text → this company's text; applied to every text cell, longest match first. */
  replace: Record<string, string>;
  /** Replaces the seven stock items in order: [name, unit]. */
  stock: [string, string][];
}

export const SAMPLE_VARIANTS: SampleVariant[] = [
  {
    id: 'sample-company-shakti-pharma',
    name: 'Shakti Pharma Labs',
    legalName: 'Shakti Pharma Labs Private Limited',
    gstin: '24AAKCS4821M1Z3',
    pan: 'AAKCS4821M',
    address: 'Survey No. 112, GIDC Phase II, Vatva, Ahmedabad, Gujarat 382445',
    scale: 1.5,
    costFactor: 0.9,
    capitalInjection: 2_500_000,
    replace: {
      'Acme Traders': 'Sanjivani Medical Agencies',
      'Vertex Industries': 'Arogya Pharma Distributors',
      'Orion Retail Pvt Ltd': 'CureWell Hospitals Pvt Ltd',
      'Bluewave Distributors': 'Lifeline Chemists',
      'Kiran Enterprises': 'Dhanvantari Drug House',
      'Zenith Stores': 'MediPoint Wholesale',
      'Lumina Exports GmbH': 'Medivia Pharma GmbH',
      'Lumina Exports': 'Medivia Pharma',
      'Nova Supplies': 'Sabarmati Chem Intermediates',
      'Apex Packaging': 'BlisterPak Solutions',
      'Global Raw Materials Ltd': 'Narmada API Industries Ltd',
      'Bright Logistics': 'ColdChain Express',
      'Skyline Properties LLP': 'Vatva Estates LLP',
      'AirNet Broadband': 'NetLink Fibre',
      'Office Mart': 'Prime Office Supplies',
      MSEDCL: 'Gujarat Power Utility',
      'Pixel & Print Media': 'Pulse Health Media',
      'Precision Engineering Works': 'Cleanroom Engineering Works',
      'United India Insurance': 'Suraksha General Insurance',
      'Mehta & Associates': 'Shah & Parikh Associates',
      'Mumbai HQ': 'Ahmedabad HQ',
      'Pune Branch': 'Vadodara Branch',
      'Delhi Branch': 'Hyderabad Branch',
      'North Zone': 'South Zone',
      Nashik: 'Vatva',
      'CNC machine': 'tablet compression machine',
    },
    stock: [
      ['Paracetamol 500 mg Tablets (10×10)', 'Box'],
      ['Amoxicillin 250 mg Capsules (10×10)', 'Box'],
      ['API — Metformin HCl', 'Kg'],
      ['Finished Goods — Cough Syrup 100 ml', 'Carton'],
      ['Blister Foil Rolls', 'Roll'],
      ['Glass Vials 10 ml', 'Box'],
      ['HEPA Filter Cartridges', 'Nos'],
    ],
  },
  {
    id: 'sample-company-kaveri-foods',
    name: 'Kaveri Foods & Beverages',
    legalName: 'Kaveri Foods & Beverages Private Limited',
    gstin: '29AAHCK7315P1Z8',
    pan: 'AAHCK7315P',
    address: 'No. 48, KIADB Industrial Area, Hebbal, Mysuru, Karnataka 570016',
    scale: 0.8,
    costFactor: 0.95,
    capitalInjection: 2_000_000,
    replace: {
      'Acme Traders': 'Namma Mart Supermarkets',
      'Vertex Industries': 'Udupi Fresh Retail',
      'Orion Retail Pvt Ltd': 'Coastal Foods Distributors Pvt Ltd',
      'Bluewave Distributors': 'Malnad Provisions',
      'Kiran Enterprises': 'Brindavan Hypermarket',
      'Zenith Stores': 'Sagar Wholesale Traders',
      'Lumina Exports GmbH': 'EuroSpice Trading GmbH',
      'Lumina Exports': 'EuroSpice Trading',
      'Nova Supplies': 'Deccan Agro Produce',
      'Apex Packaging': 'FlexiPack Pouches',
      'Global Raw Materials Ltd': 'Southern Grain & Oil Mills Ltd',
      'Bright Logistics': 'Nilgiri Cold Logistics',
      'Skyline Properties LLP': 'Hebbal Realty LLP',
      'AirNet Broadband': 'Swift Fibre Net',
      'Office Mart': 'Desk & Paper Co.',
      MSEDCL: 'Karnataka Power Utility',
      'Pixel & Print Media': 'Spice Route Media',
      'Precision Engineering Works': 'FoodTech Equipment Services',
      'United India Insurance': 'Raksha General Insurance',
      'Mehta & Associates': 'Rao & Hegde Associates',
      'Mumbai HQ': 'Bengaluru HQ',
      'Pune Branch': 'Mysuru Branch',
      'Delhi Branch': 'Chennai Branch',
      'West Zone': 'South Zone',
      'North Zone': 'East Coast Zone',
      Nashik: 'Hebbal',
      'CNC machine': 'roasting and packing line',
    },
    stock: [
      ['Filter Coffee Powder 500 g', 'Carton'],
      ['Ready-to-Eat Upma Mix 200 g', 'Carton'],
      ['Raw Coffee Beans — Arabica', 'Kg'],
      ['Finished Goods — Masala Combo Packs', 'Set'],
      ['Laminated Pouches (Large)', 'Nos'],
      ['Spice Blend Ingredients Kit', 'Box'],
      ['Cold-Pressed Groundnut Oil 15 L', 'Can'],
    ],
  },
  {
    id: 'sample-company-surya-textiles',
    name: 'Surya Textile Mills',
    legalName: 'Surya Textile Mills Private Limited',
    gstin: '24AAMCS9087Q1Z1',
    pan: 'AAMCS9087Q',
    address: 'Plot 221, Sachin GIDC, Surat, Gujarat 394230',
    scale: 1.2,
    costFactor: 1,
    capitalInjection: 1_500_000,
    replace: {
      'Acme Traders': 'Banarasi Silk House',
      'Vertex Industries': 'Trendline Apparel',
      'Orion Retail Pvt Ltd': 'Royal Garments Pvt Ltd',
      'Bluewave Distributors': 'Kolkata Saree Emporium',
      'Kiran Enterprises': 'Weave & Co. Retail',
      'Zenith Stores': 'Modern Fashion Stores',
      'Lumina Exports GmbH': 'Nordic Textiles GmbH',
      'Lumina Exports': 'Nordic Textiles',
      'Nova Supplies': 'Sarvodaya Yarn Traders',
      'Apex Packaging': 'PackRight Cartons',
      'Global Raw Materials Ltd': 'Tapi Cotton Spinners Ltd',
      'Bright Logistics': 'Tapi Freight Carriers',
      'Skyline Properties LLP': 'Sachin Industrial Estates LLP',
      'AirNet Broadband': 'CityNet Broadband',
      'Office Mart': 'Stationery World',
      MSEDCL: 'Surat Power Utility',
      'Pixel & Print Media': 'Loom & Thread Media',
      'Precision Engineering Works': 'Textile Machinery Services',
      'United India Insurance': 'Kavach General Insurance',
      'Mehta & Associates': 'Desai & Joshi Associates',
      'Mumbai HQ': 'Surat HQ',
      'Pune Branch': 'Ahmedabad Branch',
      'Delhi Branch': 'Kolkata Branch',
      'North Zone': 'East Zone',
      'Factory — Nashik': 'Mill — Sachin',
      'Nashik Plant': 'Sachin Mill',
      Nashik: 'Sachin',
      'CNC machine': 'air-jet loom',
    },
    stock: [
      ['Cotton Shirting Fabric — 60s', 'Mtr'],
      ['Polyester Viscose Suiting', 'Mtr'],
      ['Cotton Yarn 40s Combed', 'Kg'],
      ['Finished Goods — Printed Saree Sets', 'Set'],
      ['Export Cartons (Large)', 'Nos'],
      ['Dyes & Chemicals Kit', 'Box'],
      ['Loom Lubricant 20 L', 'Can'],
    ],
  },
  {
    id: 'sample-company-orbit-auto',
    name: 'Orbit Auto Components',
    legalName: 'Orbit Auto Components Private Limited',
    gstin: '33AAFCO2468R1Z6',
    pan: 'AAFCO2468R',
    address: 'B-17, SIPCOT Industrial Park, Oragadam, Chennai, Tamil Nadu 602105',
    scale: 2.2,
    costFactor: 0.88,
    capitalInjection: 4_500_000,
    replace: {
      'Acme Traders': 'Torque Motors Ltd',
      'Vertex Industries': 'Speedline Two-Wheelers',
      'Orion Retail Pvt Ltd': 'Sigma Automotive Pvt Ltd',
      'Bluewave Distributors': 'AutoParts Hub Distributors',
      'Kiran Enterprises': 'Ganesh Auto Spares',
      'Zenith Stores': 'Metro Motor Stores',
      'Lumina Exports GmbH': 'Rhein Automotive GmbH',
      'Lumina Exports': 'Rhein Automotive',
      'Nova Supplies': 'Chennai Steel Traders',
      'Apex Packaging': 'SecurePack Industrial',
      'Global Raw Materials Ltd': 'Coimbatore Castings Ltd',
      'Bright Logistics': 'Coastal Freight Lines',
      'Skyline Properties LLP': 'Oragadam Estates LLP',
      'AirNet Broadband': 'FastNet Fibre',
      'Office Mart': 'Office Essentials',
      MSEDCL: 'Tamil Nadu Power Utility',
      'Pixel & Print Media': 'Gearhead Media',
      'Precision Engineering Works': 'CNC Precision Services',
      'United India Insurance': 'Abhay General Insurance',
      'Mehta & Associates': 'Iyer & Krishnan Associates',
      'Mumbai HQ': 'Chennai HQ',
      'Pune Branch': 'Bengaluru Branch',
      'Delhi Branch': 'Gurugram Branch',
      'West Zone': 'South Zone',
      Nashik: 'Oragadam',
    },
    stock: [
      ['Brake Disc Assembly — Model A', 'Nos'],
      ['Clutch Plate Unit — Model B', 'Nos'],
      ['Alloy Steel Bar 40 mm', 'Kg'],
      ['Finished Goods — Gear Kits', 'Set'],
      ['Export Crates', 'Nos'],
      ['Bearings & Fasteners Kit', 'Box'],
      ['Cutting Oil 20 L', 'Can'],
    ],
  },
];

/* ------------------------------------------------------------------ helpers */

type Cell = XLSX.CellObject;
type Grid = { ws: XLSX.WorkSheet; range: XLSX.Range; header: Map<string, number> };

/** Ledgers whose payments are operating costs (and so take the cost factor). */
const EXPENSE_GROUPS = new Set(['Indirect Expenses', 'Direct Expenses']);
const NOT_OPERATING = new Set(['Depreciation', 'Interest on Term Loan']);
const MONEY_GROUPS = new Set(['Bank Accounts', 'Cash-in-Hand']);

function grid(ws: XLSX.WorkSheet): Grid | null {
  if (!ws['!ref']) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const header = new Map<string, number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = cell(ws, range.s.r, c)?.v;
    if (typeof v === 'string') header.set(v.trim(), c);
  }
  return { ws, range, header };
}

function cell(ws: XLSX.WorkSheet, r: number, c: number): Cell | undefined {
  return ws[XLSX.utils.encode_cell({ r, c })] as Cell | undefined;
}

function num(g: Grid, r: number, col: string): number | null {
  const c = g.header.get(col);
  if (c === undefined) return null;
  const v = cell(g.ws, r, c)?.v;
  return typeof v === 'number' ? v : null;
}

function str(g: Grid, r: number, col: string): string {
  const c = g.header.get(col);
  if (c === undefined) return '';
  const v = cell(g.ws, r, c)?.v;
  return v === undefined || v === null ? '' : String(v);
}

function setNum(g: Grid, r: number, col: string, value: number): void {
  const c = g.header.get(col);
  if (c === undefined) return;
  g.ws[XLSX.utils.encode_cell({ r, c })] = { t: 'n', v: value };
}

function setStr(g: Grid, r: number, col: string, value: string): void {
  const c = g.header.get(col);
  if (c === undefined) return;
  g.ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: value };
}

function rows(g: Grid): number[] {
  const out: number[] = [];
  for (let r = g.range.s.r + 1; r <= g.range.e.r; r++) out.push(r);
  return out;
}

/** Scales debit/credit lines, then moves any rounding difference onto the largest line so the set still balances. */
function scaleBalanced(g: Grid, lineRows: number[], factor: number): void {
  let origNet = 0;
  let newNet = 0;
  let largest: { r: number; col: 'Debit' | 'Credit'; amount: number } | null = null;
  for (const r of lineRows) {
    for (const col of ['Debit', 'Credit'] as const) {
      const v = num(g, r, col);
      if (v === null || v === 0) continue;
      const scaled = Math.round(v * factor);
      setNum(g, r, col, scaled);
      const sign = col === 'Debit' ? 1 : -1;
      origNet += sign * v;
      newNet += sign * scaled;
      if (!largest || scaled > largest.amount) largest = { r, col, amount: scaled };
    }
  }
  const diff = Math.round(origNet * factor) - newNet;
  if (diff !== 0 && largest) {
    setNum(g, largest.r, largest.col, largest.amount + (largest.col === 'Debit' ? diff : -diff));
  }
}

function replaceText(wb: XLSX.WorkBook, pairs: [string, string][]): void {
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn]!;
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const c = ws[addr] as Cell;
      if (c.t !== 's' || typeof c.v !== 'string') continue;
      let v = c.v;
      for (const [from, to] of pairs) if (v.includes(from)) v = v.split(from).join(to);
      if (v !== c.v) ws[addr] = { t: 's', v };
    }
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/(pvt|ltd|gmbh|llp|private|limited)\.?/g, '').replace(/[^a-z0-9]+/g, '');
}

/* ---------------------------------------------------------------- transform */

/** Builds one variant company's workbooks from the original demo workbooks. */
export function buildVariantWorkbooks(files: WorkbookFile[], v: SampleVariant): WorkbookFile[] {
  const books = files.map((f) => ({ name: f.originalname, wb: XLSX.read(f.buffer, { type: 'buffer', cellNF: true }) }));
  const first = (wb: XLSX.WorkBook) => grid(wb.Sheets[wb.SheetNames[0]!]!);
  const find = (re: RegExp) => books.find((b) => re.test(b.name));

  // Ledger groups from the original chart of accounts, before any renaming.
  const groupOf = new Map<string, string>();
  const coa = find(/chart_of_accounts/i);
  if (coa) {
    const g = first(coa.wb);
    if (g) for (const r of rows(g)) groupOf.set(str(g, r, 'Ledger Name'), str(g, r, 'Ledger Group'));
  }
  const isOperatingExpense = (ledger: string) => EXPENSE_GROUPS.has(groupOf.get(ledger) ?? '') && !NOT_OPERATING.has(ledger);
  const isMoney = (ledger: string) => MONEY_GROUPS.has(groupOf.get(ledger) ?? '');

  const costScale = v.scale * v.costFactor;
  const costVouchers = new Set<string>();

  // Vouchers first: they decide which payments are operating costs.
  for (const b of books.filter((x) => /voucher/i.test(x.name))) {
    const g = first(b.wb);
    if (!g) continue;
    const byVoucher = new Map<string, number[]>();
    for (const r of rows(g)) {
      const key = `${str(g, r, 'Voucher Type')}|${str(g, r, 'Voucher Number')}`;
      byVoucher.set(key, [...(byVoucher.get(key) ?? []), r]);
    }
    for (const [key, lineRows] of byVoucher) {
      const [type, number] = key.split('|');
      const ledgers = lineRows.map((r) => str(g, r, 'Ledger Name'));
      const operating =
        type === 'Payment' && ledgers.some(isOperatingExpense) && ledgers.every((l) => isOperatingExpense(l) || isMoney(l));
      if (operating) costVouchers.add(number!);
      scaleBalanced(g, lineRows, operating ? costScale : v.scale);
    }
  }

  for (const b of books) {
    const g = first(b.wb);
    if (!g) continue;
    const name = b.name;

    if (/company_details/i.test(name)) {
      for (const r of rows(g)) {
        setStr(g, r, 'Company Name', v.name);
        setStr(g, r, 'Legal Name', v.legalName);
        setStr(g, r, 'GSTIN', v.gstin);
        setStr(g, r, 'PAN', v.pan);
        setStr(g, r, 'Address', v.address);
      }
    } else if (/opening_balances/i.test(name)) {
      scaleBalanced(g, rows(g), v.scale);
      // Equal amounts on both sides, so the opening position still balances.
      for (const r of rows(g)) {
        const ledger = str(g, r, 'Ledger Name');
        if (ledger === 'HDFC Current A/c') setNum(g, r, 'Debit', (num(g, r, 'Debit') ?? 0) + v.capitalInjection);
        if (ledger === 'Share Capital') setNum(g, r, 'Credit', (num(g, r, 'Credit') ?? 0) + v.capitalInjection);
      }
    } else if (/receivables/i.test(name)) {
      for (const r of rows(g)) {
        const inv = Math.round((num(g, r, 'Invoice Amount') ?? 0) * v.scale);
        const rec = Math.round((num(g, r, 'Amount Received') ?? 0) * v.scale);
        setNum(g, r, 'Invoice Amount', inv);
        setNum(g, r, 'Amount Received', rec);
        setNum(g, r, 'Outstanding Amount', inv - rec);
      }
    } else if (/payables/i.test(name)) {
      for (const r of rows(g)) {
        const bill = Math.round((num(g, r, 'Bill Amount') ?? 0) * v.scale);
        const paid = Math.round((num(g, r, 'Amount Paid') ?? 0) * v.scale);
        setNum(g, r, 'Bill Amount', bill);
        setNum(g, r, 'Amount Paid', paid);
        setNum(g, r, 'Outstanding Amount', bill - paid);
      }
    } else if (/stock/i.test(name)) {
      rows(g).forEach((r, i) => {
        const item = v.stock[i];
        if (item) {
          setStr(g, r, 'Item Name', item[0]);
          setStr(g, r, 'Unit', item[1]);
        }
        const qty = num(g, r, 'Quantity') ?? 0;
        const value = Math.round((num(g, r, 'Value') ?? 0) * v.scale);
        setNum(g, r, 'Value', value);
        if (qty) setNum(g, r, 'Rate', Math.round((value / qty) * 100) / 100);
      });
    } else if (/expenses/i.test(name) && !/recurring/i.test(name)) {
      for (const r of rows(g)) {
        const amount = num(g, r, 'Amount');
        if (amount === null) continue;
        setNum(g, r, 'Amount', Math.round(amount * (costVouchers.has(str(g, r, 'Reference')) ? costScale : v.scale)));
      }
    } else if (/budgets|recurring/i.test(name)) {
      const amountCol = g.header.has('Budget Amount') ? 'Budget Amount' : 'Amount';
      for (const r of rows(g)) {
        const amount = num(g, r, amountCol);
        if (amount === null) continue;
        const f = isOperatingExpense(str(g, r, 'Category')) ? costScale : v.scale;
        setNum(g, r, amountCol, Math.round(amount * f));
      }
    } else if (/commitments/i.test(name)) {
      for (const r of rows(g)) {
        const amount = num(g, r, 'Amount');
        if (amount !== null) setNum(g, r, 'Amount', Math.round(amount * v.scale));
      }
    } else if (/customers/i.test(name)) {
      // Contact e-mails follow the renamed customer, so nothing points at the original names.
      for (const r of rows(g)) {
        const customer = str(g, r, 'Customer Name');
        const renamed = v.replace[customer] ?? customer;
        setStr(g, r, 'Contact Email', `accounts@${slug(renamed)}.example`);
      }
    }
  }

  const pairs = Object.entries(v.replace).sort((a, b) => b[0].length - a[0].length);
  return books.map(({ name, wb }) => {
    replaceText(wb, pairs);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { originalname: name, buffer, size: buffer.length };
  });
}
