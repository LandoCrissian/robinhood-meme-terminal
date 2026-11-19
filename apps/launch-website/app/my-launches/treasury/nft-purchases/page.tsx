import type {Metadata} from "next";
import {headers} from "next/headers";
import {NftAcquisitionDashboard} from "../../../_components/nft-acquisition-dashboard";
import {configuredNftAcquisitionFixture} from "../../../../lib/server/nft-acquisition-fixture";
export const metadata:Metadata={title:"NFT acquisition | RMT Launch"};
export default async function NftAcquisitionPage(){return <NftAcquisitionDashboard fixture={Boolean(configuredNftAcquisitionFixture(await headers()))}/>;}
