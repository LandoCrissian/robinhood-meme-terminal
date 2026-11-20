import type {WatchBinding} from "./listing-watcher.mjs";
export type NativeImportEntry={sourceKind:"OWNER_SUPPLIED";sourceId:"owner-supplied";rawUtf8:string};
export function createNativeOwnerImportFeed(options:{policyCatalogHash:string;readImports:(context:{signal?:AbortSignal})=>Promise<readonly string[]>}):(context:{binding:WatchBinding;signal?:AbortSignal})=>Promise<{status:"AVAILABLE"|"UNAVAILABLE";reason?:string;entries:Readonly<NativeImportEntry>[];publicListingVerified:false;executionEnabled:false;sourceId?:"owner-supplied";policyCatalogHash?:string}>;
