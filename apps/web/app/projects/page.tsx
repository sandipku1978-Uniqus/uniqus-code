import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import ProjectPicker from "@/components/ProjectPicker";
import { getGuestSession } from "@/lib/guest-server";
import {
  billingGuestConvertHref,
  billingSettingsHref,
  parseBillingSelection,
} from "@/lib/billing-display";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    convert?: string;
    billing_plan?: string;
    max_monthly_usd?: string;
    billing_settings?: string;
  }>;
}) {
  const store = await cookies();
  const hasWorkos = !!store.get("wos-session");
  const guest = await getGuestSession();
  const { convert, billing_plan, max_monthly_usd, billing_settings } = await searchParams;
  const billingSelection = parseBillingSelection(billing_plan, max_monthly_usd);
  const returnToBilling = billing_settings === "1";

  // A guest who just signed in with Google arrives here with BOTH cookies.
  // Hand off to the convert route (a Route Handler — only those can write
  // cookies) to move their projects onto the WorkOS account and clear the
  // guest cookie. ?convert=failed means the merge errored, so don't auto-bounce
  // again — render standard mode and let ProjectPicker surface a retry.
  if (guest && hasWorkos && convert !== "failed") {
    redirect(billingGuestConvertHref(billingSelection, returnToBilling));
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
  if ((billingSelection || returnToBilling) && convert !== "failed") {
    redirect(billingSettingsHref(billingSelection));
  }
  return (
    <ProjectPicker
      accountType="standard"
      userEmail={user.email}
      userName={[user.firstName, user.lastName].filter(Boolean).join(" ") || null}
      signOutUrl="/api/signout"
      convertFailed={convert === "failed"}
      convertRetryHref={billingGuestConvertHref(billingSelection, returnToBilling)}
    />
  );
}
