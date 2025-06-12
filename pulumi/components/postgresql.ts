import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface PostgreSQLArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    securityGroupIds: pulumi.Input<string>[];
    instanceClass: string;
    allocatedStorage: number;
    dbName: string;
    username: string;
    password: pulumi.Input<string>;
}

export class PostgreSQL extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;
    public readonly address: pulumi.Output<string>;
    public readonly port: pulumi.Output<number>;
    public readonly databaseName: pulumi.Output<string>;

    constructor(name: string, args: PostgreSQLArgs, opts?: pulumi.ComponentResourceOptions) {
        super("tinyurl:components:PostgreSQL", name, {}, opts);

        // Create DB subnet group
        const subnetGroup = new aws.rds.SubnetGroup(`${name}-subnet-group`, {
            name: `${args.projectName}-postgres-subnet-group`,
            subnetIds: args.subnetIds,
            tags: {
                Name: `${args.projectName}-postgres-subnet-group`,
                Environment: args.environment,
            },
        }, { parent: this });

        // Create RDS instance
        const dbInstance = new aws.rds.Instance(`${name}-instance`, {
            identifier: `${args.projectName}-postgres`,
            engine: "postgres",
            engineVersion: "17.5",
            instanceClass: args.instanceClass,
            allocatedStorage: args.allocatedStorage,
            storageType: "gp3",
            storageEncrypted: true,
            dbName: args.dbName,
            username: args.username,
            password: args.password,
            vpcSecurityGroupIds: args.securityGroupIds,
            dbSubnetGroupName: subnetGroup.name,
            backupRetentionPeriod: 7,
            backupWindow: "03:00-04:00",
            maintenanceWindow: "sun:04:00-sun:05:00",
            skipFinalSnapshot: true,
            deletionProtection: false,
            enabledCloudwatchLogsExports: ["postgresql"],
            tags: {
                Name: `${args.projectName}-postgres`,
                Environment: args.environment,
            },
        }, { parent: this });

        this.endpoint = dbInstance.endpoint;
        this.address = dbInstance.address;
        this.port = dbInstance.port;
        this.databaseName = dbInstance.dbName;

        this.registerOutputs({
            endpoint: this.endpoint,
            address: this.address,
            port: this.port,
            databaseName: this.databaseName,
        });
    }
}