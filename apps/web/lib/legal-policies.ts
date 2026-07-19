export interface LegalPolicyLinks {
  terms: string | null;
  privacy: string | null;
}

function httpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
    const isLocal =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname === "::1";
    return url.protocol === "https:" && !isLocal && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function legalPolicyLinks(
  terms = process.env.NEXT_PUBLIC_TERMS_OF_SERVICE_URL,
  privacy = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL,
): LegalPolicyLinks {
  return { terms: httpsUrl(terms), privacy: httpsUrl(privacy) };
}
