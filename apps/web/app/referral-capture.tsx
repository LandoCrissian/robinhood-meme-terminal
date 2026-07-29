"use client";

import { useEffect, useRef } from "react";
import { claimPendingReferral } from "../lib/referrals";
import { useProfile } from "./profile-provider";

export function ReferralCapture() {
  const { identityUpdatedAt, user } = useProfile();
  const attemptedForUser = useRef("");

  useEffect(() => {
    if (!user || !identityUpdatedAt || attemptedForUser.current === user.uid) return;
    attemptedForUser.current = user.uid;
    void claimPendingReferral(user);
  }, [identityUpdatedAt, user]);

  return null;
}
