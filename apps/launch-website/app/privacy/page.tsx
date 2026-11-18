import type { Metadata } from "next";

export const metadata: Metadata = { title: "Website Privacy | RMT Launch" };

export default function PrivacyPage() {
  return <>
    <header className="lpPageHeading"><div><h1>Website Privacy</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>Information handled by this website</h2>
      <p>Launch search filters verified records in your browser. When account services are enabled, connecting shares your public wallet address; a separate gas-free sign-in message verifies control. Private keys and recovery phrases are never requested.</p>
      <p>Creator names, usernames, wallet addresses, bios, avatars and HTTPS links are public. Appearance and motion preferences remain private. Sessions use protected server cookies; sign-in messages have a short expiry and can be used once.</p>
      <p>Profile avatars are resized and re-encoded. Token descriptions and artwork in an unsubmitted creation draft remain on your device. Signing in does not publish that draft.</p>
      <p>You can remove profile data from the profile editor after fresh wallet verification. Public blockchain transactions and launch registrations remain on-chain.</p>
      <p>Hosted previews with account services disabled cannot sign you in or save profile changes. Local Firebase emulator tests use synthetic identities and separate data.</p>
      <p>The hosting provider may process standard network and request data to deliver and secure the website.</p>
    </section>
  </>;
}
