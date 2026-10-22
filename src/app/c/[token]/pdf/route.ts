/** PDF for a customer, authorised by their document link. */
import { getDb } from "@/db/client";
import { renderDocumentPdf } from "@/pdf/render";
import { printableInvoice, printableQuote } from "@/services/printable";
import { resolveCustomerLink } from "@/services/support";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const link = await resolveCustomerLink(db, token);
  if (!link || link.kind === "variation")
    return new Response("This link has expired or is not valid.", { status: 404 });
  const doc =
    link.kind === "quote"
      ? await printableQuote(db, link.businessId, link.targetId)
      : await printableInvoice(db, link.businessId, link.targetId);
  const bytes = await renderDocumentPdf(doc);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.number.split(" ")[0]}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
