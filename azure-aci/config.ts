import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

const name = new random.RandomString("resourcegroup-name", {
    length: 6,
    special: false,
    upper: false,
});

const password = new random.RandomPassword("mysql-password", {
    length: 16,
});

export const resourceGroupName = pulumi.interpolate`t-${name.result}`;
export const mysqlPassword = pulumi.secret(password.result);
