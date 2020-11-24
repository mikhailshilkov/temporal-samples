import * as docker from "@pulumi/docker"
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random"
import * as kubernetes from "@pulumi/kubernetes";

import * as authorization from "@pulumi/azure-nextgen/authorization/latest";
import * as containerregistry from "@pulumi/azure-nextgen/containerregistry/latest";

export interface MySqlArgs {
    type: "mysql";
    hostName: pulumi.Input<string>;
    login: pulumi.Input<string>;
    password: pulumi.Input<string>;
}

export interface ClusterArgs {
    kubeConfig: pulumi.Input<string>;
    principalId: pulumi.Input<string>;
}

export interface AppArgs {
    namespace: pulumi.Input<string>;
    folder: pulumi.Input<string>;
    port: pulumi.Input<number>;
}

export interface TemporalArgs {
    resourceGroupName: pulumi.Input<string>;
    location: pulumi.Input<string>;
    version: string;
    storage: MySqlArgs;
    cluster: ClusterArgs;
    app: AppArgs;
}

export class Temporal extends pulumi.ComponentResource {
    public webEndpoint: pulumi.Output<string>;
    public starterEndpoint: pulumi.Output<string>;

    constructor(name: string, args: TemporalArgs) {
        super("my:example:Temporal", name, args, undefined);

        const registry = new containerregistry.Registry("registry", {
            resourceGroupName: args.resourceGroupName,
            registryName: pulumi.output(args.resourceGroupName).apply(rg => rg.replace("-", "")),
            location: args.location,
            sku: {
                name: "Basic",
            },
            adminUserEnabled: true,
        }, { parent: this });
        
        const credentials = pulumi.all([args.resourceGroupName, registry.name]).apply(
            ([resourceGroupName, registryName]) => containerregistry.listRegistryCredentials({
                resourceGroupName: resourceGroupName,
                registryName: registryName,
        }));
        const adminUsername = credentials.apply(credentials => credentials.username!);
        const adminPassword = credentials.apply(credentials => credentials.passwords![0].value!);
        
        const customImage = "temporal-worker";
        const myImage = new docker.Image(customImage, {
            imageName: pulumi.interpolate`${registry.loginServer}/${customImage}`,
            build: { context: "./workflow" },
            registry: {
                server: registry.loginServer,
                username: adminUsername,
                password: adminPassword,
            },
        }, { parent: this });
        
        const roleName = new random.RandomUuid("role-name");        
        new authorization.RoleAssignment("access-from-cluster", {
            properties: {
                principalId: args.cluster.principalId,
                roleDefinitionId: "/subscriptions/0282681f-7a9e-424b-80b2-96babd57a8a1/providers/Microsoft.Authorization/roleDefinitions/7f951dda-4ed3-4680-a7ca-43fe172d538d",
            },
            roleAssignmentName: roleName.result,
            scope: registry.id,
        }, { parent: this });
        
        const provider = new kubernetes.Provider("k8s-provider", {
            kubeconfig: args.cluster.kubeConfig,
        }, { parent: this });
        
        const k8sOptions = { provider: provider, parent: this };

        if (args.app.namespace != "default") {
            new kubernetes.core.v1.Namespace("temporal-ns", {
                metadata: {
                    name: args.app.namespace,
                },
            }, k8sOptions);
        }
        
        const temporalDefaultStorePassword = new kubernetes.core.v1.Secret("temporal-default-store", {
            metadata: {
                name: "temporal-default-store",
                namespace: args.app.namespace,
                labels: {
                    "app.kubernetes.io/name": "temporal",
                }
            },
            type: "Opaque",
            data: {
                password: pulumi.output(args.storage.password).apply(pwd => Buffer.from(pwd, "utf-8").toString("base64")),
            },
        }, k8sOptions);
        
        const workerDeployment = new kubernetes.apps.v1.Deployment("temporal-worker", {
            metadata: {
                namespace: args.app.namespace,
                labels: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/version": "0.1.0",
                    "app.kubernetes.io/component": "worker",
                    "app.kubernetes.io/part-of": "temporal",
                },
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "temporal",
                        "app.kubernetes.io/component": "worker"
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "temporal",
                            "app.kubernetes.io/version": "0.1.0",
                            "app.kubernetes.io/component": "worker",
                            "app.kubernetes.io/part-of": "temporal",
                        },
                    },
                    spec: {
                        containers: [
                            {
                                name: "temporal-worker",
                                image: `temporalio/auto-setup:${args.version}`,
                                imagePullPolicy: "IfNotPresent",
                                env: [
                                    {
                                        name: "AUTO_SETUP",
                                        value: "true",
                                    },
                                    {
                                        name: "DB",
                                        value: "mysql",
                                    },
                                    {
                                        name: "MYSQL_SEEDS",
                                        value: args.storage.hostName,
                                    },
                                    {
                                        name: "MYSQL_USER",
                                        value: args.storage.login,
                                    },
                                    {
                                        name: "MYSQL_PWD",
                                        valueFrom: {
                                            secretKeyRef: {
                                                name: "temporal-default-store",
                                                key: "password",
                                            },
                                        },
                                    },
                                ],
                                ports: [
                                    {
                                        name: "rpc",
                                        containerPort: 7233,
                                        protocol: "TCP",
                                    },
                                ],
                                livenessProbe: {
                                    initialDelaySeconds: 150,
                                    tcpSocket: {
                                        port: "rpc",
                                    },
                                },
                            },
                        ],
                    },
                },
            },
        }, k8sOptions);
        
        // worker service
        const workerService = new kubernetes.core.v1.Service("temporal-worker", {
            metadata: {
                name: "temporal-worker",
                namespace: args.app.namespace,
                labels: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/version": "0.1.0",
                    "app.kubernetes.io/component": "worker",
                    "app.kubernetes.io/part-of": "temporal",
                },
            },
            spec: {
                type: "ClusterIP",
                clusterIP: "None",
                ports: [
                    {
                        name: "rpc",
                        port: 7233,
                        targetPort: "rpc",
                        protocol: "TCP",
                    },
                ],
                selector: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/component": "worker",
                }
            }
        }, { ...k8sOptions, dependsOn: [workerDeployment] });

        const webDeployment = new kubernetes.apps.v1.Deployment("temporal-web", {
            metadata: {
                namespace: args.app.namespace,
                labels: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/version": "0.1.0",
                    "app.kubernetes.io/component": "web",
                    "app.kubernetes.io/part-of": "temporal",
                },
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "temporal",
                        "app.kubernetes.io/component": "web",
                    }
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "temporal",
                            "app.kubernetes.io/version": "0.1.0",
                            "app.kubernetes.io/component": "web",
                            "app.kubernetes.io/part-of": "temporal",
                        }
                    },
                    spec: {
                        containers: [
                            {
                                name: "temporal-web",
                                image: `temporalio/web:${args.version}`,
                                imagePullPolicy: "IfNotPresent",
                                env: [
                                    {
                                        name: "TEMPORAL_GRPC_ENDPOINT",
                                        value: "temporal-worker.temporal.svc.cluster.local:7233"
                                    }
                                ],
                                ports: [
                                    {
                                        name: "http",
                                        containerPort: 8088,
                                        protocol: "TCP",
                                    }
                                ],
                                livenessProbe: {
                                    initialDelaySeconds: 150,
                                    tcpSocket: {
                                        port: "http",
                                    },
                                },
                            },
                        ],
                    },
                },
            },
        }, k8sOptions);
        
        // web service
        const webService = new kubernetes.core.v1.Service("temporal-web", {
            metadata: {
                name: "temporal-web",
                namespace: args.app.namespace,
                labels: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/version": "0.1.0",
                    "app.kubernetes.io/component": "web",
                    "app.kubernetes.io/part-of": "temporal",
                }
            },
            spec: {
                type: "LoadBalancer",
                ports: [
                    {
                        name: "http",
                        port: 8088,
                        targetPort: "http",
                        protocol: "TCP",
                    }
                ],
                selector: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/component": "web",
                }
            }
        }, { ...k8sOptions, dependsOn: [webDeployment] });
        
        const address = webService.status.loadBalancer.ingress[0].ip;
        this.webEndpoint = pulumi.interpolate`http://${address}:8088`;
        
        const appDeployment = new kubernetes.apps.v1.Deployment("workflow-app", {
            metadata: {
                namespace: args.app.namespace,
                labels: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/version": "0.1.0",
                    "app.kubernetes.io/component": "app",
                    "app.kubernetes.io/part-of": "temporal",
                }
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "temporal",
                        "app.kubernetes.io/component": "app",
                    }
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "temporal",
                            "app.kubernetes.io/version": "0.1.0",
                            "app.kubernetes.io/component": "app",
                            "app.kubernetes.io/part-of": "temporal",
                        }
                    },
                    spec: {
                        containers: [
                            {
                                name: "temporal-app",
                                image: myImage.imageName,
                                imagePullPolicy: "IfNotPresent",
                                env: [
                                    {
                                        name: "TEMPORAL_GRPC_ENDPOINT",
                                        value: "temporal-worker.temporal.svc.cluster.local:7233",
                                    },
                                ],
                                ports: [
                                    {
                                        name: "http",
                                        containerPort: 8080,
                                        protocol: "TCP",
                                    }
                                ],
                                livenessProbe: {
                                    initialDelaySeconds: 150,
                                    tcpSocket: {
                                        port: "http",
                                    },
                                },
                            },
                        ],
                    },
                },
            },
        }, k8sOptions);
        
        const appService = new kubernetes.core.v1.Service("workflow-app", {
            metadata: {
                name: "temporal-app",
                namespace: args.app.namespace,
                labels: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/version": "0.1.0",
                    "app.kubernetes.io/component": "app",
                    "app.kubernetes.io/part-of": "temporal",
                }
            },
            spec: {
                type: "LoadBalancer",
                ports: [
                    {
                        name: "http",
                        port: 8080,
                        targetPort: "http",
                        protocol: "TCP",
                    }
                ],
                selector: {
                    "app.kubernetes.io/name": "temporal",
                    "app.kubernetes.io/component": "app",
                }
            }
        }, { ...k8sOptions, dependsOn: [appDeployment] });
        
        const appAddress = appService.status.loadBalancer.ingress[0].ip;
        this.starterEndpoint = pulumi.interpolate`http://${appAddress}:8080/async?name=`;
        
        this.registerOutputs();
    }
}
