import * as pulumi from "@pulumi/pulumi";
import * as azuread from "@pulumi/azuread";
import * as random from "@pulumi/random";
import * as tls from "@pulumi/tls";
import * as containerservice from "@pulumi/azure-nextgen/containerservice/latest";

export interface ClusterArgs {
    resourceGroupName: pulumi.Input<string>;
    location: pulumi.Input<string>;
    kubernetesVersion: pulumi.Input<string>;
    vmSize: pulumi.Input<string>;
    vmCount: pulumi.Input<number>;
}

export class AksCluster extends pulumi.ComponentResource {
    public kubeConfig: pulumi.Output<string>;
    public principalId: pulumi.Output<string>;

    constructor(name: string, args: ClusterArgs) {
        super("my:example:AksCluster", name, args, undefined);

        // Create an AD service principal
        const adApp = new azuread.Application("aks");
        const adSp = new azuread.ServicePrincipal("aksSp", {
            applicationId: adApp.applicationId,
        }, {parent: this});

        // Generate random password
        const password = new random.RandomPassword("password", {
            length: 20,
            special: true,
        }, {parent: this});

        // Create the Service Principal Password
        const adSpPassword = new azuread.ServicePrincipalPassword("aksSpPassword", {
            servicePrincipalId: adSp.id,
            value: password.result,
            endDate: "2099-01-01T00:00:00Z",
        }, {parent: this});

        // Generate an SSH key
        const sshKey = new tls.PrivateKey("ssh-key", {
            algorithm: "RSA",
            rsaBits: 4096,
        }, {parent: this});

        const clusterName = pulumi.interpolate`${args.resourceGroupName}-aks`;
        const cluster = new containerservice.ManagedCluster("managedCluster", {
            resourceGroupName: args.resourceGroupName,
            addonProfiles: {
                KubeDashboard: {
                    enabled: true,
                },
            },
            agentPoolProfiles: [{
                count: args.vmCount,
                maxPods: 110,
                mode: "System",
                name: "agentpool",
                osDiskSizeGB: 30,
                osType: "Linux",
                type: "VirtualMachineScaleSets",
                vmSize: args.vmSize,
            }],
            dnsPrefix: pulumi.interpolate`${args.resourceGroupName}aks`,
            enableRBAC: true,
            identity: {
                type: "SystemAssigned",
            },
            kubernetesVersion: args.kubernetesVersion,
            linuxProfile: {
                adminUsername: "adminuser",
                ssh: {
                    publicKeys: [{
                        keyData: sshKey.publicKeyOpenssh,
                    }],
                },
            },
            location: args.location,
            nodeResourceGroup: pulumi.interpolate`MC_${clusterName}`,
            resourceName: clusterName,
            servicePrincipalProfile: {
                clientId: adApp.applicationId,
                secret: adSpPassword.value,
            },
        }, {parent: this});  
        
        const creds = pulumi.all([cluster.name, args.resourceGroupName]).apply(([clusterName, rgName]) => {
            return containerservice.listManagedClusterUserCredentials({
                resourceGroupName: rgName,
                resourceName: clusterName,
            });
        });

        const encoded = creds.kubeconfigs[0].value;
        this.kubeConfig = encoded.apply(enc => Buffer.from(enc, "base64").toString());
        this.principalId = cluster.identityProfile.apply(p => p!["kubeletidentity"].objectId!);

        this.registerOutputs();
    }
}

