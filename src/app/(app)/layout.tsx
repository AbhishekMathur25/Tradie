import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/services/directory";

const OWNER_LINKS = [
  { href: "/dashboard", label: "Today" },
  { href: "/jobs", label: "Jobs" },
  { href: "/invoices", label: "Invoices" },
  { href: "/payments", label: "Payments" },
  { href: "/customers", label: "Customers" },
  { href: "/price-book", label: "Price list" },
  { href: "/outbox", label: "Outbox" },
  { href: "/settings", label: "Settings" },
];

// Crew see jobs only; no money anywhere.
const CREW_LINKS = [{ href: "/jobs", label: "Jobs" }];

/** Signed-in shell: top bar with navigation by role. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const business = await getBusiness(await getDb(), user.businessId);
  const links = user.role === "owner" ? OWNER_LINKS : CREW_LINKS;
  return (
    <>
      <div className="tape" />
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            {business.name}
          </Link>
          <nav className="nav" aria-label="Main">
            {links.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="who">
            <span>
              {user.name} · {user.role}
            </span>
            <form action={logoutAction}>
              <button type="submit" className="link">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
