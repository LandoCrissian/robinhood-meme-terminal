import {handleNftAcquisitionRead,handleNftAcquisitionTest} from "../../../lib/server/nft-acquisition-actions";
export const dynamic="force-dynamic";
export const GET=handleNftAcquisitionRead;
export const HEAD=handleNftAcquisitionRead;
export const POST=handleNftAcquisitionTest;
