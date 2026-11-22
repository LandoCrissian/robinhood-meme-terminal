import { permanentRedirect } from "next/navigation";
export default async function LegacyPeoplePage({searchParams}:{searchParams:Promise<{after?:string|string[]}>}) {
  const {after}=await searchParams;
  permanentRedirect(typeof after==="string"?"/people?after="+encodeURIComponent(after):"/people");
}
