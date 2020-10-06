import * as pulumi from "@pulumi/pulumi";
import * as mysql from "@pulumi/azure-nextgen/dbformysql/latest";

export interface MySqlArgs {
    resourceGroupName: pulumi.Input<string>;
    location: pulumi.Input<string>;
    administratorLogin: pulumi.Input<string>;
    administratorPassword: pulumi.Input<string>;
}

export class MySql extends pulumi.ComponentResource {
    public hostName: pulumi.Output<string>;
    public administratorLogin: pulumi.Output<string>;
    public administratorPassword: pulumi.Output<string>;

    constructor(name: string, args: MySqlArgs) {
        super("my:example:MySql", name, args, undefined);

        const serverName = pulumi.interpolate`${args.resourceGroupName}-mysql`;

        this.administratorLogin = pulumi.interpolate`${args.administratorLogin}@${serverName}`;
        this.administratorPassword = pulumi.output(args.administratorPassword);

        const mySQL = new mysql.Server("mysql", {
            resourceGroupName: args.resourceGroupName,
            location: args.location,
            serverName,
            properties: {
                version: "5.7",
                administratorLogin: args.administratorLogin,
                administratorLoginPassword: args.administratorPassword,
                storageProfile: {
                    storageMB: 5120,
                    backupRetentionDays: 7,
                    geoRedundantBackup: "Disabled",
                    storageAutogrow: "Disabled",
                },
                createMode: "Default",
                infrastructureEncryption: "Disabled",
                sslEnforcement: "Disabled",
                
            },
            sku: {
                name: "B_Gen5_1",
                tier: "Basic",
                capacity: 1,
                size: "5120",
                family: "Gen5"
            },
        }, {parent: this});
        
        new mysql.FirewallRule("mysql-allow-all", {
            resourceGroupName: args.resourceGroupName,
            serverName: mySQL.name,
            firewallRuleName: "allow-all",
            startIpAddress: "0.0.0.0",
            endIpAddress: "255.255.255.255",
        }, {parent: this});

        this.hostName = mySQL.fullyQualifiedDomainName.apply(v => v!);

        this.registerOutputs();
    }
}

