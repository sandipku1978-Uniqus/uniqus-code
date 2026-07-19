import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import SettingsView from "@/components/SettingsView";
import { getGuestSession } from "@/lib/guest-server";
import {
  billingGuestConvertHref,
  billingLoginHref,
  parseBillingSelection,
} from "@/lib/billing-display";

/** Coordinate guest/WorkOS identity and billing intent before rendering Settings. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; max_monthly_usd?: string }>;
}) {
  const store = await cookies();
  const hasWorkos = !!store.get("wos-session");
  const guest = await getGuestSession();
  const params = await searchParams;
  const billingSelection = parseBillingSelection(params.plan, params.max_monthly_usd);
  const signupHref = billingLoginHref(billingSelection, true);

  if (guest && hasWorkos) {
    redirect(billingGuestConvertHref(billingSelection, true));
  }

  if (guest && !hasWorkos) {
    return (
      <SettingsView
        accountType="guest"
        userEmail={null}
        userName={guest.displayName}
        signOutUrl="/api/guest/signout"
        signupHref={signupHref}
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
      signupHref={signupHref}
    />
  );
}
