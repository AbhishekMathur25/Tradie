import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

/** Sends people to the right starting page. */
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(user.role === "owner" ? "/dashboard" : "/jobs");
}
