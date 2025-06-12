import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface RedisArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    securityGroupIds: pulumi.Input<string>[];
    nodeType: string;
}

export class Redis extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;
    public readonly port: pulumi.Output<number>;
    public readonly clusterId: pulumi.Output<string>;

    constructor(name: string, args: RedisArgs, opts?: pulumi.ComponentResourceOptions) {
        super("tinyurl:components:Redis", name, {}, opts);

        // Create ElastiCache subnet group
        const subnetGroup = new aws.elasticache.SubnetGroup(`${name}-subnet-group`, {
            name: `${args.projectName}-redis-subnet-group`,
            subnetIds: args.subnetIds,
            tags: {
                Name: `${args.projectName}-redis-subnet-group`,
                Environment: args.environment,
            },
        }, { parent: this });

        // Create ElastiCache cluster
        const cluster = new aws.elasticache.Cluster(`${name}-cluster`, {
            clusterId: `${args.projectName}-redis`,
            engine: "redis",
            nodeType: args.nodeType,
            numCacheNodes: 1,
            parameterGroupName: "default.redis7",
            engineVersion: "7.0",
            port: 6379,
            subnetGroupName: subnetGroup.name,
            securityGroupIds: args.securityGroupIds,
            snapshotRetentionLimit: 5,
            snapshotWindow: "03:00-05:00",
            tags: {
                Name: `${args.projectName}-redis`,
                Environment: args.environment,
            },
        }, { parent: this });

        this.clusterId = cluster.id;
        this.port = cluster.port;
        this.endpoint = cluster.cacheNodes.apply(nodes => nodes[0].address);

        this.registerOutputs({
            endpoint: this.endpoint,
            port: this.port,
            clusterId: this.clusterId,
        });
    }
}