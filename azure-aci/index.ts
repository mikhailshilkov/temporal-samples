import * as resources from "@pulumi/azure-nextgen/resources/latest";

import { resourceGroupName, mysqlPassword } from "./config";
import { MySql } from "./mysql";
import { Temporal } from "./temporal";

const resourceGroup = new resources.ResourceGroup("rg", {
    resourceGroupName: resourceGroupName,
    location: "westeurope",
});

const database = new MySql("mysql", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    administratorLogin: "mikhail",
    administratorPassword: mysqlPassword,
});

const temporal = new Temporal("temporal", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    version: "0.29.0",
    storage: {
        type: "mysql",
        hostName: database.hostName,
        login: database.administratorLogin,
        password: database.administratorPassword,
    },
    app: {
        folder: "./workflow",
        port: 8080,
    },
});

export const serverEndpoint = temporal.serverEndpoint;
export const webEndpoint = temporal.webEndpoint;
export const starterEndpoint = temporal.starterEndpoint;
