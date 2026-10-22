/** PDF of a quote or invoice for the signed-in owner. */
import { getDb } from "@/db/client";
import { currentUser } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import { renderDocumentPdf } from "@/pdf/render";
import { printableInvoice, printableQuote } from "@/services/printable";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const user = await currentUser();
  if (!user || user.role !== "owner") return new Response("Not allowed", { status: 403 });
  const { kind, id } = await params;
  if (kind !== "quote" && kind !== "invoice") return new Response("Not found", { status: 404 });
  try {
    const db = await getDb();
    const doc =
      kind === "quote"
        ? await printableQuote(db, user.businessId, id)
        : await printableInvoice(db, user.businessId, id);
    const bytes = await renderDocumentPdf(doc);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${doc.number.split(" ")[0]}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof UserFacingError) return new Response(error.message, { status: 404 });
    throw error;
  }
}
