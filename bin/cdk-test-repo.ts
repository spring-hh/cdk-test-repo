#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkTestRepoStack } from '../lib/cdk-test-repo-stack';

const app = new cdk.App();
new CdkTestRepoStack(app, 'CdkTestRepoStack');
