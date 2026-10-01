'use client';

// دعوة مخدوم — رابط/QR يحمل دعوة صالحة إلى /child/signup (signup_invites · 20261004120000)
import SignupInvitePanel from '@/components/SignupInvitePanel';

export default function ChildInvitePanel() {
  return <SignupInvitePanel kind="child" />;
}
