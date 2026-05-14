import { cookies } from "next/headers";
import { withAuth } from "@workos-inc/authkit-nextjs";
import Workspace from "@/components/Workspace";
import { getGuestSession } from "@/lib/guest-server";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = await cookies();

  // Guest accounts have no WorkOS session, so withAuth({ ensureSignedIn })
  // would bounce them to /login. Render the workspace directly — the
  // orchestrator's WS auth verifies the guest cookie and project ownership,
  // and Workspace reads account_type from the session_started event to gate
  // the GitHub + deploy affordances. WorkOS takes precedence when both
  // cookies are present (mirrors authenticate() in the orchestrator).
  if (!store.get("wos-session") && (await getGuestSession())) {
    return <Workspace projectId={id} signOutUrl="/api/guest/signout" />;
  }

  await withAuth({ ensureSignedIn: true });
  return <Workspace projectId={id} signOutUrl="/api/signout" />;
}
