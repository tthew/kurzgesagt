import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface LoadBalancerArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    securityGroupId: pulumi.Input<string>;
    targetGroupArn: pulumi.Input<string>;
}

export class LoadBalancer extends pulumi.ComponentResource {
    public readonly dnsName: pulumi.Output<string>;
    public readonly zoneId: pulumi.Output<string>;
    public readonly arn: pulumi.Output<string>;
    public readonly listenerArn: pulumi.Output<string>;

    constructor(name: string, args: LoadBalancerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("tinyurl:components:LoadBalancer", name, {}, opts);

        // Create Application Load Balancer
        const alb = new aws.lb.LoadBalancer(`${name}-alb`, {
            name: `${args.projectName}-alb`,
            internal: false,
            loadBalancerType: "application",
            securityGroups: [args.securityGroupId],
            subnets: args.subnetIds,
            enableDeletionProtection: false,
            enableHttp2: true,
            tags: {
                Name: `${args.projectName}-alb`,
                Environment: args.environment,
            },
        }, { parent: this });

        // Create HTTP listener
        const httpListener = new aws.lb.Listener(`${name}-http-listener`, {
            loadBalancerArn: alb.arn,
            port: 80,
            protocol: "HTTP",
            defaultActions: [{
                type: "forward",
                targetGroupArn: args.targetGroupArn,
            }],
        }, { parent: this });

        // Optional: HTTPS listener (requires SSL certificate)
        // const httpsListener = new aws.lb.Listener(`${name}-https-listener`, {
        //     loadBalancerArn: alb.arn,
        //     port: 443,
        //     protocol: "HTTPS",
        //     sslPolicy: "ELBSecurityPolicy-2016-08",
        //     certificateArn: args.certificateArn,
        //     defaultActions: [{
        //         type: "forward",
        //         targetGroupArn: args.targetGroupArn,
        //     }],
        // }, { parent: this });

        this.dnsName = alb.dnsName;
        this.zoneId = alb.zoneId;
        this.arn = alb.arn;
        this.listenerArn = httpListener.arn;

        this.registerOutputs({
            dnsName: this.dnsName,
            zoneId: this.zoneId,
            arn: this.arn,
            listenerArn: this.listenerArn,
        });
    }
}