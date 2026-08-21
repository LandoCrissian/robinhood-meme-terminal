import {
  acrossInfrastructurePreflightFailure,
  runAcrossInfrastructurePreflight
} from "../lib/server/vnext-across-infrastructure-preflight";

void runAcrossInfrastructurePreflight()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((cause) => {
    console.error(JSON.stringify(acrossInfrastructurePreflightFailure(cause), null, 2));
    process.exitCode = 1;
  });
