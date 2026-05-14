import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import ProjectPicker from "@/components/ProjectPicker";
import { getGuestSession } from "@/lib/guest-server";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ convert?: string }>;
}) {
  const store = await cookies();
  const hasWorkos = !!store.get("wos-session");
  const guest = await getGuestSession();
  const { convert } = await searchParams;

  // A guest who just signed in with Google arrives here with BOTH cookies.
  // Hand off to the convert route (a Route Handler — only those can write
  // cookies) to move their projects onto the WorkOS account and clear the
  // guest cookie. ?convert=failed means the merge errored, so don't auto-bounce
  // again — render standard mode and let ProjectPicker surface a retry.
  if (guest && hasWorkos && convert !== "failed") {
    redirect("/api/guest/convert");
  }

  // Guest mode — no WorkOS session. Skip withAuth(), which would redirect to
  // /login. The display name is cached in the guest cookie itself.
  if (guest && !hasWorkos) {
    return (
      <ProjectPicker
        accountType="guest"
        userEmail={null}
        userName={guest.displayName}
        signOutUrl="/api/guest/signout"
      />
    );
  }

  const { user } = await withAuth({ ensureSignedIn: true });
  return (
    <ProjectPicker
      accountType="standard"
      userEmail={user.email}
      userName={[user.firstName, user.lastName].filter(Boolean).join(" ") || null}
      signOutUrl="/api/signout"
      convertFailed={convert === "failed"}
    />
  );
}
