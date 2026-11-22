import type { Metadata } from "next";
export const metadata: Metadata = { title: "Website Privacy | RMT Launch" };
export default function Page() {
  return <article className="lpReading lpPolicy"><header className="lpPageHeading"><h1>Website Privacy</h1></header>
    <section><h2>Your profile</h2><p>Your username, display name, wallet address, bio, avatar, X handle and project links are public. They can appear in People, on your profile and on social cards. Your appearance and motion preferences are private.</p></section>
    <section><h2>Wallet sign-in</h2><p>Connecting shares a public wallet address. Signing the gas-free message proves control of that address. Firebase verifies the session and protected cookies restore it on this browser. RMT Launch never asks for private keys or recovery phrases.</p></section>
    <section><h2>Drafts and public artwork</h2><p>Token details and unsaved image selections stay in this browser. Saving token artwork publishes a resized image and a content-addressed metadata URL. Removing an image from a draft does not remove the published artwork. The draft description stays on your device.</p></section>
    <section><h2>Removal and caching</h2><p>You can replace or remove your avatar in the editor. Removing profile data requires fresh wallet verification. Previously shared images may remain in social or browser caches. Public blockchain records persist. Hosting providers process connection and request data to deliver the site.</p></section>
  </article>;
}
