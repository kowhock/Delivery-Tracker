import { requireAdmin } from "@/lib/auth";

export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return children;
}
