export async function getClerkSessionToken(): Promise<string | null> {
  if (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) return null;
  try {
    const clerk = (window as unknown as {
      Clerk?: { session?: { getToken?: () => Promise<string | null> } };
    }).Clerk;
    return await (clerk?.session?.getToken?.() ?? Promise.resolve(null));
  } catch {
    return null;
  }
}

export async function withClerkBillingHeader(
  headers: Record<string, string>,
): Promise<Record<string, string>> {
  const clerkToken = await getClerkSessionToken();
  return clerkToken ? { ...headers, "x-clerk-session-token": clerkToken } : headers;
}

