import { redirect } from "next/navigation";
import { SignInCard } from "@/components/sign-in-card";
import { getUserId } from "@/lib/supabase/server";

/**
 * The front door: a sign-in card when signed out, a hand-off to /home when signed in.
 *
 * force-dynamic is doing real work here. Which of the two renders depends entirely
 * on who is asking, and without it Next would decide once at build time that
 * everyone is signed out and serve that to everyone from cache.
 *
 * Signed out, this is the only page in the app that renders. The proxy sends every
 * protected route here, so a second gate elsewhere would only be a way around this
 * one.
 *
 * Signed in, this no longer renders the splash. It used to, and that is the change
 * worth being explicit about: the title card and /home were two documents, and the
 * P had to be positioned at the centre of one and the corner of the other with the
 * two geometry sets agreeing to the pixel. A redirect is simpler and it is exact —
 * there is no handover to get wrong, so nothing can drift between two renders of
 * the same letter.
 *
 * The intro therefore plays entirely on /home. What that costs in fidelity, the
 * shared Mark component still pays for: sign-in and home draw the same letter from
 * the same numbers, so they cannot differ in weight or brightness across the
 * navigation.
 *
 * The intro flag is NOT set here. It looks like it should be — this is the arrival
 * the animation belongs to — but a server component cannot write a cookie, and the
 * in-memory half of the flag (sessionStorage) does not exist on the server at all.
 * Calling the setter from here would throw twice into two empty catch blocks and
 * appear to work. src/proxy.ts sets the cookie instead, because the proxy runs on
 * the runtime that is allowed to write one.
 */
export const dynamic = "force-dynamic";

export default async function Index({ searchParams }: PageProps<"/">) {
  if (await getUserId()) {
    redirect("/home");
  }

  /* Google's refusal comes back on this route as a query parameter, set by
     auth/callback so the reader is told what happened instead of watching a
     redirect that quietly does nothing. */
  const params = await searchParams;
  const error = params.auth_error;

  return <SignInCard message={typeof error === "string" ? error : undefined} />;
}