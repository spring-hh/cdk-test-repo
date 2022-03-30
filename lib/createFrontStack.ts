import { CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface Props {
  frontName: string;
}

export class createFrontStack {
  private stack: Stack;
  private props: Props;
  private repo: codecommit.Repository;
  private targetBucket: s3.Bucket;
  private websiteIdentity: cloudfront.OriginAccessIdentity;
  private distribution: cloudfront.CloudFrontWebDistribution;
  private buildProject: codebuild.PipelineProject;
  private postBuildProject: codebuild.PipelineProject;
  private invalidateBuildProject: codebuild.PipelineProject;
  private sourceOutput: codepipeline.Artifact;
  private buildOutput: codepipeline.Artifact;
  private sourceAction: codepipeline_actions.CodeCommitSourceAction;
  private buildAction: codepipeline_actions.CodeBuildAction;
  private postBuildAction: codepipeline_actions.CodeBuildAction;
  private deployAction: codepipeline_actions.S3DeployAction;
  private invalidateCacheAction: codepipeline_actions.CodeBuildAction;

  public constructor(stack: Stack, props: Props) {
    this.stack = stack;
    this.props = props;
    this.initialize();
  }

  private initialize() {
    this.createSourceRepo();
    this.createTargetBucket();
    this.createOAI();
    this.attatchResticBucketPolicy();
    this.createDistribution();
    this.createBuildProject();
    this.createPostBuildProject();
    this.addRoleToPostBuildProject();
    this.createInvalidateBuildProject();
    this.addRoleToInvalidBuildProject();
    this.sourceOutput = new codepipeline.Artifact();
    this.buildOutput = new codepipeline.Artifact();
    this.createSourceAction();
    this.createBuildAction();
    this.createPostBuildAction();
    this.createDeployAction();
    this.createInvalidateCacheAction();
    this.createPipeline();
  }

  private createSourceRepo() {
    this.repo = new codecommit.Repository(
      this.stack,
      `${this.props.frontName}Repo`,
      {
        repositoryName: `${this.props.frontName}Repo`,
        description: `${this.props.frontName}Repo`,
      }
    );
  }

  private createTargetBucket() {
    this.targetBucket = new s3.Bucket(
      this.stack,
      `${this.props.frontName}Bucket`,
      {
        // publicReadAccess: true,
        websiteIndexDocument: "index.html",
        websiteErrorDocument: "index.html",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );
  }

  private createOAI() {
    this.websiteIdentity = new cloudfront.OriginAccessIdentity(
      this.stack,
      `${this.props.frontName}WebsiteIdentity`,
      {
        comment: `website-identity`,
      }
    );
  }

  private attatchResticBucketPolicy() {
    const webSiteBucketPolicyStatement = new iam.PolicyStatement({
      actions: ["s3:GetObject"],
      effect: iam.Effect.ALLOW,
      principals: [
        new iam.CanonicalUserPrincipal(
          this.websiteIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId
        ),
      ],
      resources: [`${this.targetBucket.bucketArn}/*`],
    });
    this.targetBucket.addToResourcePolicy(webSiteBucketPolicyStatement);
  }

  private createDistribution() {
    this.distribution = new cloudfront.CloudFrontWebDistribution(
      this.stack,
      `${this.props.frontName}Distribution`,
      {
        originConfigs: [
          {
            behaviors: [
              {
                isDefaultBehavior: true,
              },
            ],
            s3OriginSource: {
              s3BucketSource: this.targetBucket,
              originAccessIdentity: this.websiteIdentity,
            },
          },
        ],
      }
    );

    new CfnOutput(
      this.stack,
      `${this.props.frontName} cloudfront distribution: `,
      {
        value: this.distribution.distributionDomainName,
      }
    );
  }
  private createBuildProject() {
    this.buildProject = new codebuild.PipelineProject(
      this.stack,
      `${this.props.frontName}Build`,
      {
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
        },
        buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.yml"),
        projectName: `${this.props.frontName}Build`,
      }
    );
  }

  private createPostBuildProject() {
    this.postBuildProject = new codebuild.PipelineProject(
      this.stack,
      `${this.props.frontName}PostBuild`,
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: ["aws s3 rm s3://${BUCKET_NAME} --recursive"],
            },
          },
        }),
        environmentVariables: {
          BUCKET_NAME: { value: this.targetBucket.bucketName },
        },
      }
    );
  }

  private addRoleToPostBuildProject() {
    this.postBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: [
          this.targetBucket.bucketArn,
          `${this.targetBucket.bucketArn}/*`,
        ],
      })
    );
  }

  private createInvalidateBuildProject() {
    this.invalidateBuildProject = new codebuild.PipelineProject(
      this.stack,
      `${this.props.frontName}InvalidateProject`,
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                'aws cloudfront create-invalidation --distribution-id ${CLOUDFRONT_ID} --paths "/*"',
              ],
            },
          },
        }),
        environmentVariables: {
          CLOUDFRONT_ID: { value: this.distribution.distributionId },
        },
      }
    );
  }

  private addRoleToInvalidBuildProject() {
    const distributionArn = `arn:aws:cloudfront::${this.stack.account}:distribution/${this.distribution.distributionId}`;
    this.invalidateBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [distributionArn],
        actions: ["cloudfront:CreateInvalidation"],
      })
    );
  }

  private createSourceAction() {
    this.sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: "CodeCommit",
      repository: this.repo,
      output: this.sourceOutput,
    });
  }

  private createBuildAction() {
    this.buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: "CodeBuild",
      project: this.buildProject,
      input: this.sourceOutput,
      outputs: [this.buildOutput],
      runOrder: 1,
    });
  }

  private createPostBuildAction() {
    this.postBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: "postCodeBuild",
      project: this.postBuildProject,
      input: this.sourceOutput,
      runOrder: 2,
    });
  }

  private createDeployAction() {
    this.deployAction = new codepipeline_actions.S3DeployAction({
      actionName: "S3Deploy",
      bucket: this.targetBucket,
      input: this.buildOutput,
      runOrder: 1,
    });
  }

  private createInvalidateCacheAction() {
    this.invalidateCacheAction = new codepipeline_actions.CodeBuildAction({
      actionName: "InvalidateCache",
      project: this.invalidateBuildProject,
      input: this.buildOutput,
      runOrder: 2,
    });
  }

  private createPipeline() {
    new codepipeline.Pipeline(this.stack, `${this.props.frontName}Pipeline`, {
      pipelineName: `${this.props.frontName}Pipeline`,
      stages: [
        {
          stageName: "Source",
          actions: [this.sourceAction],
        },
        {
          stageName: "Build",
          actions: [this.buildAction, this.postBuildAction],
          // actions: [unitTestAction, buildAction],
        },
        {
          stageName: "Deploy",
          actions: [this.deployAction, this.invalidateCacheAction],
        },
      ],
    });
  }
}
