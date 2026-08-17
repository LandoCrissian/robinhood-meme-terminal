import { type EcosystemProjectProfile } from "../../lib/vnext/distribution-ecosystem-profile";

type DistributionEcosystemProjectProfileProps = {
  profile: EcosystemProjectProfile;
};

export function DistributionEcosystemProjectProfile({ profile }: DistributionEcosystemProjectProfileProps) {
  return <article>
    <h3>PROJECT</h3>
    <p><strong>{profile.projectName}</strong> / {profile.collectionLabel}</p>
    <dl>
      <div><dt>Network</dt><dd>{profile.networkName}</dd></div>
      <div><dt>Project summary</dt><dd>{profile.description}</dd></div>
      <div><dt>Collection contract</dt><dd><a href={profile.explorerAddressUrl} target="_blank" rel="noreferrer">{profile.collectionAddress}</a></dd></div>
      <div><dt>Blockscout</dt><dd><a href={profile.explorerAddressUrl} target="_blank" rel="noreferrer">Open explorer ↗</a></dd></div>
      {profile.website ? <div><dt>Website</dt><dd><a href={profile.website.url} target="_blank" rel="noreferrer">{profile.website.label} ↗</a></dd></div> : null}
      {profile.xProfiles.length > 0 ? <div><dt>Social</dt><dd>
        <div>{profile.xProfiles.map((item) => <div key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a></div>)}</div>
      </dd></div> : null}
      <div><dt>Disclosure</dt><dd>{profile.disclosure}</dd></div>
    </dl>
  </article>;
}
