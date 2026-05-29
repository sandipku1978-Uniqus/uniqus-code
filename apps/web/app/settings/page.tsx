import { cookies } from "next/headers";
import { withAuth } from "@workos-inc/authkit-nextjs";
import SettingsView from "@/components/SettingsView";
import { getGuestSession } from "@/lib/guest-server";

/**
 * Account settings (#8). Functional where the backend already supports it
 * (profile, GitHub connection, sign out); everything that would need new
 * persistence (default model, custom prompts, appearance) is scaffolded with a
 * "coming soon" marker rather than faked. Per-project things (connectors,
 * secrets, skills) are surfaced as pointers to where they live in the workspace.
 */
export default async function SettingsPage() {
  const store = await cookies();
  const hasWorkos = !!store.get("wos-session");
  const guest = await getGuestSession();

  if (guest && !hasWorkos) {
    return (
      <SettingsView
        accountType="guest"
        userEmail={null}
        userName={guest.displayName}
        signOutUrl="/api/guest/signout"
      />
    );
  }

  const { user } = await withAuth({ ensureSignedIn: true });
  return (
    <SettingsView
      accountType="standard"
      userEmail={user.email}
      userName={[user.firstName, user.lastName].filter(Boolean).join(" ") || null}
      signOutUrl="/api/signout"
    />
  );
}
