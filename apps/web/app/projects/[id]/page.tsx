import { withAuth } from "@workos-inc/authkit-nextjs";
import Workspace from "@/components/Workspace";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await withAuth({ ensureSignedIn: true });
  const { id } = await params;
  return <Workspace projectId={id} signOutUrl="/api/signout" />;
}
