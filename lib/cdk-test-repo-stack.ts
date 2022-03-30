import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { createFrontStack } from "./createFrontStack";

export class CdkTestRepoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new createFrontStack(this, { frontName: "Front" });
  }
}
