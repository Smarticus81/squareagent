import { useEffect, useRef } from "react";
import { useAuth as useClerkAuth, useClerk, useSignIn } from "@clerk/clerk-react";
import { useAuth } from "@/hooks/use-auth";

/**
 * Silently links the logged-in VoyceLab account to its Clerk identity so Clerk
 * Billing works without a second login:
 *   1. When a VoyceLab user is present but Clerk has no session (or no active
 *      organization), it asks the API for a one-time Clerk sign-in ticket and
 *      establishes the Clerk session + active org in the background.
 *   2. When the VoyceLab token is gone (logout), it signs out of Clerk too.
 *
 * Mount this only when Clerk is configured (i.e. inside <ClerkProvider/>).
 * Renders nothing.
 */
export function ClerkIdentityBridge() {
  const { data: auth } = useAuth();
  const clerk = useClerk();
  const { isLoaded: clerkLoaded, isSignedIn, orgId } = useClerkAuth();
  const { isLoaded: signInLoaded, signIn } = useSignIn();

  // Guard so we attempt the link at most once per (user, missing-org) state.
  const linkingRef = useRef(false);

  useEffect(() => {
    if (!clerkLoaded || !signInLoaded) return;

    const hasVoycelabToken = Boolean(localStorage.getItem("voycelab_token"));

    // Logout: tear down the Clerk session when VoyceLab is no longer signed in.
    if (!hasVoycelabToken || !auth?.user) {
      linkingRef.current = false;
      if (isSignedIn) clerk.signOut().catch(() => {});
      return;
    }

    // Already linked with an active organization — nothing to do.
    if (isSignedIn && orgId) return;
    if (linkingRef.current) return;
    linkingRef.current = true;

    (async () => {
      try {
        const token = localStorage.getItem("voycelab_token");
        if (!token) return;

        const res = await fetch("/api/auth/clerk-link", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          signInToken?: string;
          clerkOrgId?: string | null;
        };
        const clerkOrgId = data.clerkOrgId ?? undefined;

        if (isSignedIn) {
          // Session exists but no active org — activate the linked org.
          if (clerkOrgId) await clerk.setActive({ organization: clerkOrgId });
          return;
        }

        if (!data.signInToken || !signIn) return;
        const attempt = await signIn.create({ strategy: "ticket", ticket: data.signInToken });
        if (attempt.status === "complete" && attempt.createdSessionId) {
          await clerk.setActive({ session: attempt.createdSessionId, organization: clerkOrgId });
        }
      } catch {
        // Swallow — billing surfaces still offer a manual Clerk sign-in fallback.
      } finally {
        linkingRef.current = false;
      }
    })();
  }, [auth?.user, clerkLoaded, signInLoaded, isSignedIn, orgId, signIn, clerk]);

  return null;
}
