import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { CouchDB } from "./components/couchdb";
import { PostgreSQL } from "./components/postgresql";
import { Redis } from "./components/redis";
import { AppServer } from "./components/appserver";
import { LoadBalancer } from "./components/loadbalancer";
import { DebugLambda } from "./components/debug-lambda";

// Get configuration
const config = new pulumi.Config();
const projectName = config.require("projectName");
const environment = config.require("environment");
const vpcCidr = config.require("vpcCidr");
const availabilityZones = config.requireObject<string[]>("availabilityZones");

// Create VPC
const vpc = new awsx.ec2.Vpc(`${projectName}-vpc`, {
    cidrBlock: vpcCidr,
    numberOfAvailabilityZones: availabilityZones.length,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: {
        Name: `${projectName}-vpc`,
        Environment: environment,
    },
});

// Security Groups
const appSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-app-sg`, {
    description: "Security group for application servers",
    vpcId: vpc.vpcId,
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    tags: {
        Name: `${projectName}-app-sg`,
        Environment: environment,
    },
});

const albSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-alb-sg`, {
    description: "Security group for Application Load Balancer",
    vpcId: vpc.vpcId,
    ingress: [
        {
            fromPort: 80,
            toPort: 80,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
        {
            fromPort: 443,
            toPort: 443,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    tags: {
        Name: `${projectName}-alb-sg`,
        Environment: environment,
    },
});

const databaseSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-database-sg`, {
    description: "Security group for databases",
    vpcId: vpc.vpcId,
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    tags: {
        Name: `${projectName}-database-sg`,
        Environment: environment,
    },
});

// Security group rules
new aws.ec2.SecurityGroupRule("app-ingress-from-alb", {
    type: "ingress",
    fromPort: 3000,
    toPort: 3000,
    protocol: "tcp",
    sourceSecurityGroupId: albSecurityGroup.id,
    securityGroupId: appSecurityGroup.id,
});

new aws.ec2.SecurityGroupRule("postgres-ingress", {
    type: "ingress",
    fromPort: 5432,
    toPort: 5432,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});

new aws.ec2.SecurityGroupRule("redis-ingress", {
    type: "ingress",
    fromPort: 6379,
    toPort: 6379,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});

new aws.ec2.SecurityGroupRule("couchdb-ingress", {
    type: "ingress",
    fromPort: 5984,
    toPort: 5984,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});

// Create CouchDB
const couchdb = new CouchDB("couchdb", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetId: vpc.privateSubnetIds[0],
    securityGroupId: databaseSecurityGroup.id,
    instanceType: config.require("couchdbInstanceType"),
});

// Create PostgreSQL
const postgresPassword = config.requireSecret("postgresPassword");
const postgres = new PostgreSQL("postgres", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupIds: [databaseSecurityGroup.id],
    instanceClass: config.require("postgresInstanceClass"),
    allocatedStorage: config.requireNumber("postgresStorageSize"),
    dbName: config.require("postgresDbName"),
    username: config.require("postgresUsername"),
    password: postgresPassword,
});

// Create Redis
const redis = new Redis("redis", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupIds: [databaseSecurityGroup.id],
    nodeType: config.require("redisNodeType"),
});

// Create App Server
const appServer = new AppServer("app-server", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupId: appSecurityGroup.id,
    instanceType: config.require("appInstanceType"),
    desiredCapacity: config.requireNumber("appDesiredCapacity"),
    minSize: config.requireNumber("appMinSize"),
    maxSize: config.requireNumber("appMaxSize"),
    postgresEndpoint: postgres.endpoint,
    postgresUsername: config.require("postgresUsername"),
    postgresPassword: postgresPassword,
    postgresDbName: config.require("postgresDbName"),
    redisEndpoint: redis.endpoint,
    couchdbEndpoint: couchdb.endpoint,
});

// Create Load Balancer
const loadBalancer = new LoadBalancer("load-balancer", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.publicSubnetIds as unknown as [string],
    securityGroupId: albSecurityGroup.id,
    targetGroupArn: appServer.targetGroupArn,
});

// Create Debug Lambda
const debugLambda = new DebugLambda("debug-lambda", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupId: appSecurityGroup.id,
});

// Exports
export const loadBalancerDns = loadBalancer.dnsName;
export const tinyurlAppUrl = pulumi.interpolate`http://${loadBalancer.dnsName}`;
export const postgresEndpoint = postgres.endpoint;
export const redisEndpoint = redis.endpoint;
export const couchdbEndpoint = couchdb.endpoint;
export const couchdbPrivateIp = couchdb.privateIp;
export const couchdbInstanceId = couchdb.instanceId;
export const vpcId = vpc.vpcId;
export const appServerAsgName = appServer.asgName;
export const debugLambdaName = debugLambda.functionName;