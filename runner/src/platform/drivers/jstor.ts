import { createManualPlatformDriver } from "../driver-contract.js";

export const jstorPlatformDriver = createManualPlatformDriver("jstor", ["record_then_pdf"]);
