import {handleSeaportAcquisitionRead,handleSeaportAcquisitionTest} from "../../../lib/server/seaport-acquisition-actions";
export const dynamic="force-dynamic";
export const GET=handleSeaportAcquisitionRead;
export const HEAD=handleSeaportAcquisitionRead;
export const POST=handleSeaportAcquisitionTest;
