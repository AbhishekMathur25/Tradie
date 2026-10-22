/**
 * Renders quotes and invoices to PDF with pdf-lib (pure JavaScript, no
 * headless browser). Layout is A4, built from simple text and lines.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatCents, formatQuantity, lineAmountCents, type Line } from "@/domain/money";

export interface PrintableDocument {
  title: string; // "Tax invoice", "Invoice", "Quote"
  number: string;
  business: {
    name: string;
    abn: string;
    licenceNumber: string;
    licenseeName: string;
    email: string;
    phone: string;
    bankAccountName: string;
    bankBsb: string;
    bankAccountNumber: string;
  };
  showLicence: boolean;
  customer: { name: string; address: string; abn: string };
  jobTitle: string;
  siteAddress: string;
  facts: Array<[string, string]>; // e.g. ["Issued", "22 Oct 2026"]
  lines: Line[];
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  gstRegistered: boolean;
  payment?: { payId: string; reference: string; dueOn: string; outstandingCents: number };
  notes: string;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.086, 0.125, 0.169);
const MUTED = rgb(0.3, 0.345, 0.4);
const HIVIS = rgb(0.886, 0.345, 0.043);

/** Standard PDF fonts only cover Latin-1; swap or drop anything else. */
export function toPdfText(value: string): string {
  return value
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of toPdfText(text).split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

export async function renderDocumentPdf(doc: PrintableDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(toPdfText(`${doc.title} ${doc.number}`));
  pdf.setAuthor(toPdfText(doc.business.name));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const text = (value: string, x: number, size = 10, font = regular, color = INK) => {
    page.drawText(toPdfText(value), { x, y, size, font, color });
  };
  const textRight = (value: string, right: number, size = 10, font = regular) => {
    const safe = toPdfText(value);
    page.drawText(safe, {
      x: right - font.widthOfTextAtSize(safe, size),
      y,
      size,
      font,
      color: INK,
    });
  };
  const newPageIfNeeded = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
    }
  };
  const right = A4.width - MARGIN;

  // Header: hi-vis rule, business on the left, document title on the right.
  page.drawRectangle({ x: 0, y: A4.height - 8, width: A4.width, height: 8, color: HIVIS });
  text(doc.business.name, MARGIN, 16, bold);
  textRight(doc.title.toUpperCase(), right, 16, bold);
  y -= 18;
  const businessLines = [
    doc.business.abn ? `ABN ${doc.business.abn}` : "",
    doc.showLicence
      ? `Contractor licence ${doc.business.licenceNumber} · ${doc.business.licenseeName}`
      : "",
    [doc.business.email, doc.business.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);
  for (const line of businessLines) {
    text(line, MARGIN, 9, regular, MUTED);
    y -= 12;
  }
  y += 12 * businessLines.length;
  textRight(doc.number, right, 11, bold);
  y -= 14;
  for (const [label, value] of doc.facts) {
    textRight(`${label}: ${value}`, right, 9);
    y -= 12;
  }
  y = Math.min(y, A4.height - MARGIN - 18 - 12 * businessLines.length) - 16;

  // Customer and job
  text("BILL TO", MARGIN, 8, bold, MUTED);
  text("JOB", A4.width / 2, 8, bold, MUTED);
  y -= 13;
  const customerLines = [
    doc.customer.name,
    doc.customer.address,
    doc.customer.abn ? `ABN ${doc.customer.abn}` : "",
  ].filter(Boolean);
  const jobLines = [doc.jobTitle, doc.siteAddress].filter(Boolean);
  for (let i = 0; i < Math.max(customerLines.length, jobLines.length); i += 1) {
    if (customerLines[i]) text(customerLines[i], MARGIN, 10, i === 0 ? bold : regular);
    if (jobLines[i]) text(jobLines[i], A4.width / 2, 10, i === 0 ? bold : regular);
    y -= 13;
  }
  y -= 12;

  // Lines table
  const cols = { qty: right - 190, unit: right - 95, amount: right };
  const descriptionWidth = cols.qty - MARGIN - 50;
  page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end: { x: right, y: y + 4 },
    thickness: 1,
    color: INK,
  });
  y -= 10;
  text("DESCRIPTION", MARGIN, 8, bold, MUTED);
  textRight("QTY", cols.qty, 8, bold);
  textRight("UNIT (EX GST)", cols.unit, 8, bold);
  textRight("AMOUNT", cols.amount, 8, bold);
  y -= 14;
  for (const line of doc.lines) {
    const wrapped = wrap(line.description, regular, 10, descriptionWidth);
    newPageIfNeeded(wrapped.length * 13 + 6);
    textRight(formatQuantity(line.quantityMilli), cols.qty);
    textRight(formatCents(line.unitPriceCents), cols.unit);
    textRight(formatCents(lineAmountCents(line)), cols.amount);
    for (const part of wrapped) {
      text(part, MARGIN);
      y -= 13;
    }
    y -= 3;
  }
  page.drawLine({
    start: { x: MARGIN, y: y + 6 },
    end: { x: right, y: y + 6 },
    thickness: 0.5,
    color: MUTED,
  });
  y -= 10;

  // Totals
  newPageIfNeeded(60);
  const totalRows: Array<[string, string, PDFFont]> = [
    ["Subtotal (excl. GST)", formatCents(doc.subtotalCents), regular],
    [doc.gstRegistered ? "GST" : "GST (not registered)", formatCents(doc.gstCents), regular],
    [doc.gstRegistered ? "Total (incl. GST)" : "Total", formatCents(doc.totalCents), bold],
  ];
  for (const [label, value, font] of totalRows) {
    textRight(label, cols.unit, 10, font);
    textRight(value, cols.amount, 10, font);
    y -= 14;
  }
  y -= 10;

  // How to pay
  if (doc.payment) {
    newPageIfNeeded(80);
    text("HOW TO PAY", MARGIN, 8, bold, MUTED);
    y -= 14;
    text(
      `Amount due: ${formatCents(doc.payment.outstandingCents)} by ${doc.payment.dueOn}`,
      MARGIN,
      10,
      bold,
    );
    y -= 13;
    text(`PayID: ${doc.payment.payId}    Reference: ${doc.payment.reference}`, MARGIN);
    y -= 13;
    if (doc.business.bankBsb && doc.business.bankAccountNumber) {
      text(
        `Bank transfer: ${doc.business.bankAccountName} · BSB ${doc.business.bankBsb} · Account ${doc.business.bankAccountNumber}`,
        MARGIN,
      );
      y -= 13;
    }
    text(
      "Please use the reference so your payment is matched automatically.",
      MARGIN,
      9,
      regular,
      MUTED,
    );
    y -= 18;
  }

  if (doc.notes) {
    const wrapped = wrap(doc.notes, regular, 10, right - MARGIN);
    newPageIfNeeded(wrapped.length * 13 + 20);
    text("NOTES", MARGIN, 8, bold, MUTED);
    y -= 14;
    for (const part of wrapped) {
      newPageIfNeeded(13);
      text(part, MARGIN);
      y -= 13;
    }
  }

  return pdf.save();
}
