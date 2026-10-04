"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { dayKey } from "@/lib/dates";

/**
 * Every screen that says "today" gets its date from the server, so the day is
 * right on every visit. What it cannot cover is a tab left open overnight, or a
 * phone that went to sleep with the app in front of it: that wakes up still
 * holding yesterday, and the sports question it asks is yesterday's question.
 *
 * So the clock is re-read here, and the server components are refreshed when
 * the local day has genuinely turned over. Refreshed rather than reloaded, so
 * anything already logged survives the rollover.
 */
export function DayRollover() {
  const router = useRouter();
  const day = useRef<string | null>(null);

  useEffect(() => {
    const check = () => {
      const now = dayKey(new Date());
      /* The first call only records which day we started on. Refreshing on
         mount would be a wasted render every single visit. */
      if (day.current === null) {
        day.current = now;
        return;
      }
      if (now === day.current) return;
      day.current = now;
      router.refresh();
    };

    /* Not aligned to midnight on purpose: a device that slept through it
       resumes with a timer that fires whenever it feels like it, which is why
       the visibility and focus checks below are the ones that matter. */
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [router]);

  return null;
}
