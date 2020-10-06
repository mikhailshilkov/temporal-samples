import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as containerinstance from "@pulumi/azure-nextgen/containerinstance/latest";
import * as containerregistry from "@pulumi/azure-nextgen/containerregistry/latest";

export interface MySqlArgs {
    type: "mysql";
    hostName: pulumi.Input<string>;
    login: pulumi.Input<string>;
    password: pulumi.Input<string>;
}

export interface AppArgs {
    folder: pulumi.Input<string>;
    port: pulumi.Input<number>;
}

export interface TemporalArgs {
    resourceGroupName: pulumi.Input<string>;
    location: pulumi.Input<string>;
    version: string;
    storage: MySqlArgs;
    app: AppArgs;
}

export class Temporal extends pulumi.ComponentResource {
    public serverEndpoint: pulumi.Output<string>;
    public webEndpoint: pulumi.Output<string>;
    public starterEndpoint: pulumi.Output<string>;

    constructor(name: string, args: TemporalArgs) {
        super("my:example:Temporal", name, args, undefined);

        let env = [
            { name: "AUTO_SETUP", value: <pulumi.Input<string>>"true" },
        ];

        if (args.storage.type === "mysql") {
            env.push({ name: "DB", value: "mysql" });
            env.push({ name: "MYSQL_SEEDS", value: args.storage.hostName });
            env.push({ name: "MYSQL_USER", value: args.storage.login });
            env.push({ name: "MYSQL_PWD", value: args.storage.password });
        }

        const temporalServer = new containerinstance.ContainerGroup("temporal-server", {
            resourceGroupName: args.resourceGroupName,
            containerGroupName: pulumi.interpolate`${args.resourceGroupName}-server`,
            location: args.location,
            osType: "Linux",
            ipAddress: {
                type: "Public",
                ports: [{ protocol: "TCP", port: 7233 }],
            },
            containers: [{
                name: "temporalio-server",
                image: pulumi.interpolate`temporalio/server:${args.version}`,
                ports: [{port: 7233}],
                resources: {
                    requests: {
                        memoryInGB: 1,
                        cpu: 1,
                    },
                },
                environmentVariables: env,
            }],
        
        }, {parent: this});

        this.serverEndpoint = pulumi.interpolate`${temporalServer.ipAddress.apply(ip => ip?.ip)}:7233`;

        const temporalWeb = new containerinstance.ContainerGroup("temporal-web", {
            resourceGroupName: args.resourceGroupName,
            containerGroupName: pulumi.interpolate`${args.resourceGroupName}-web`,
            location: args.location,
            osType: "Linux",
            ipAddress: {
                type: "Public",
                ports: [{ protocol: "TCP", port: 8088 }],
            },
            containers: [{
                name: "temporalio-web",
                image: pulumi.interpolate`temporalio/web:${args.version}`,
                ports: [{port: 8088}],
                resources: {
                    requests: {
                        memoryInGB: 1,
                        cpu: 1,
                    },
                },
                environmentVariables: [
                    { name: "TEMPORAL_GRPC_ENDPOINT", value: this.serverEndpoint },
                ],
            }],
        }, {parent: this});

        this.webEndpoint = pulumi.interpolate`http://${temporalWeb.ipAddress.apply(ip => ip?.ip)}:8088`;

        const customImage = "temporal-worker";
        const registry = new containerregistry.Registry("registry", {
            resourceGroupName: args.resourceGroupName,
            registryName: pulumi.output(args.resourceGroupName).apply(rg => rg.replace("-", "")),
            location: args.location,
            sku: {
                name: "Basic",
            },
            adminUserEnabled: true,
        }, {parent: this});

        const credentials = pulumi.all([args.resourceGroupName, registry.name]).apply(
            ([resourceGroupName, registryName]) => containerregistry.listRegistryCredentials({
                resourceGroupName: resourceGroupName,
                registryName: registryName,
        }));
        const adminUsername = credentials.apply(credentials => credentials.username!);
        const adminPassword = credentials.apply(credentials => credentials.passwords![0].value!);

        const myImage = new docker.Image(customImage, {
            imageName: pulumi.interpolate`${registry.loginServer}/${customImage}`,
            build: { context: args.app.folder },
            registry: {
                server: registry.loginServer,
                username: adminUsername,
                password: adminPassword,
            },
        }, {parent: this});

        const temporalWorker = new containerinstance.ContainerGroup("temporal-worker", {
            resourceGroupName: args.resourceGroupName,
            containerGroupName: pulumi.interpolate`${args.resourceGroupName}-worker`,
            location: args.location,
            osType: "Linux",
            ipAddress: {
                type: "Public",
                ports: [{ protocol: "TCP", port: args.app.port }],
            },
            imageRegistryCredentials: [{
                server: registry.loginServer,
                username: adminUsername,
                password: adminPassword,
            }],
            containers: [{
                name: "temporalio-worker",
                image: myImage.imageName,
                ports: [{ port: args.app.port }],
                resources: {
                    requests: {
                        memoryInGB: 1,
                        cpu: 1,
                    },
                },
                environmentVariables: [
                    { name: "TEMPORAL_GRPC_ENDPOINT", value: this.serverEndpoint },
                ],
            }],
        }, {parent: this});

        this.starterEndpoint = pulumi.interpolate`http://${temporalWorker.ipAddress.apply(ip => ip?.ip)}:${args.app.port}/async?name=`;

        this.registerOutputs();
    }
}
