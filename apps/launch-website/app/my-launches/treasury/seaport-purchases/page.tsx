import {headers} from "next/headers";
import {notFound} from "next/navigation";
import {configuredSeaportAcquisition} from "../../../../lib/server/seaport-acquisition";
import {SeaportAcquisitionDashboard} from "../../../_components/seaport-acquisition-dashboard";
export const dynamic="force-dynamic";
export default async function SeaportPurchasesPage(){if(!configuredSeaportAcquisition(await headers()))notFound();return <SeaportAcquisitionDashboard/>;}
