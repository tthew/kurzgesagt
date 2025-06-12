import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface DebugLambdaArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    securityGroupId: pulumi.Input<string>;
}

export class DebugLambda extends pulumi.ComponentResource {
    public readonly functionArn: pulumi.Output<string>;
    public readonly functionName: pulumi.Output<string>;

    constructor(name: string, args: DebugLambdaArgs, opts?: pulumi.ComponentResourceOptions) {
        super("tinyurl:components:DebugLambda", name, {}, opts);

        // Create IAM role for Lambda
        const role = new aws.iam.Role(`${name}-role`, {
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Action: "sts:AssumeRole",
                    Effect: "Allow",
                    Principal: {
                        Service: "lambda.amazonaws.com",
                    },
                }],
            }),
        }, { parent: this });

        // Attach policies
        new aws.iam.RolePolicyAttachment(`${name}-basic`, {
            role: role.name,
            policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
        }, { parent: this });

        // Create Lambda function
        const lambda = new aws.lambda.Function(`${name}-function`, {
            runtime: "python3.9",
            handler: "index.handler",
            role: role.arn,
            timeout: 30,
            vpcConfig: {
                subnetIds: args.subnetIds,
                securityGroupIds: [args.securityGroupId],
            },
            environment: {
                variables: {
                    PROJECT_NAME: args.projectName,
                    ENVIRONMENT: args.environment,
                },
            },
            code: new pulumi.asset.AssetArchive({
                "index.py": new pulumi.asset.StringAsset(`
import json
import urllib.request
import socket

def handler(event, context):
    target_host = event.get('host', 'localhost')
    target_port = event.get('port', 3000)
    
    results = {
        'dns_resolution': None,
        'port_check': None,
        'http_check': None,
        'error': None
    }
    
    try:
        # DNS resolution
        ip = socket.gethostbyname(target_host)
        results['dns_resolution'] = {
            'success': True,
            'ip': ip
        }
        
        # Port check
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((target_host, target_port))
        sock.close()
        
        results['port_check'] = {
            'success': result == 0,
            'port': target_port,
            'result_code': result
        }
        
        # HTTP check
        if result == 0:
            try:
                url = f"http://{target_host}:{target_port}/health"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = response.read().decode('utf-8')
                    results['http_check'] = {
                        'success': True,
                        'status_code': response.getcode(),
                        'response': json.loads(data)
                    }
            except Exception as e:
                results['http_check'] = {
                    'success': False,
                    'error': str(e)
                }
                
    except Exception as e:
        results['error'] = str(e)
    
    return {
        'statusCode': 200,
        'body': json.dumps(results, indent=2)
    }
`),
            }),
        }, { parent: this });

        this.functionArn = lambda.arn;
        this.functionName = lambda.name;

        this.registerOutputs({
            functionArn: this.functionArn,
            functionName: this.functionName,
        });
    }
}