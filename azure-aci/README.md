[![Deploy](https://get.pulumi.com/new/button.svg)](https://app.pulumi.com/new)

# Deploy a Temporal Dev Environment to Azure Container Instances

Starting point for building an instance of Temporal Server and Workflows in Container Instances.

The example uses [Pulumi](https://www.pulumi.com) to deploy several Temporal components to an Azure account:

- MySQL database for storage
- Temporal Server
- Temporal Web Console
- Azure Container Registry
- Docker image with a workflow implementation
- Temporal Worker and HTTP server to start workflows

## Running the App

1.  Create a new stack:

    ```
    $ pulumi stack init dev
    ```

1.  Login to Azure CLI (you will be prompted to do this during deployment if you forget this step):

    ```
    $ az login
    ```

1.  Restore NPM dependencies:

    ```
    $ npm install
    ```

1.  Run `pulumi up` to preview and deploy changes:

    ```
    $ pulumi up
    Previewing changes:
        Type                                                         Name                    Plan       
    +   pulumi:pulumi:Stack                                          temporal-azure-aci-dev  create     
    +   ├─ my:example:MySql                                          mysql                   create   
    +   │  ├─ azure-nextgen:dbformysql/latest:Server                 mysql                   create 
    +   │  └─ azure-nextgen:dbformysql/latest:FirewallRule           mysql-allow-all         create 
    +   ├─ my:example:Temporal                                       temporal                create   
    +   │  ├─ docker:image:Image                                     temporal-worker         create 
    +   │  ├─ azure-nextgen:containerregistry/latest:Registry        registry                create 
    +   │  ├─ azure-nextgen:containerinstance/latest:ContainerGroup  temporal-server         create 
    +   │  ├─ azure-nextgen:containerinstance/latest:ContainerGroup  temporal-worker         create 
    +   │  └─ azure-nextgen:containerinstance/latest:ContainerGroup  temporal-web            create 
    +   ├─ random:index:RandomPassword                               mysql-password          create   
    +   ├─ random:index:RandomString                                 resourcegroup-name      create   
    +   └─ azure-nextgen:resources/latest:ResourceGroup              rg                      create 

    Performing changes:
        Type                                                         Name                    Status      
    +   pulumi:pulumi:Stack                                          temporal-azure-aci-dev  created     
    +   ├─ my:example:MySql                                          mysql                   created  
    +   │  ├─ azure-nextgen:dbformysql/latest:Server                 mysql                   created
    +   │  └─ azure-nextgen:dbformysql/latest:FirewallRule           mysql-allow-all         created
    +   ├─ my:example:Temporal                                       temporal                created  
    +   │  ├─ docker:image:Image                                     temporal-worker         created
    +   │  ├─ azure-nextgen:containerregistry/latest:Registry        registry                created
    +   │  ├─ azure-nextgen:containerinstance/latest:ContainerGroup  temporal-server         created
    +   │  ├─ azure-nextgen:containerinstance/latest:ContainerGroup  temporal-web            created
    +   │  └─ azure-nextgen:containerinstance/latest:ContainerGroup  temporal-worker         created
    +   ├─ random:index:RandomString                                 resourcegroup-name      created  
    +   ├─ random:index:RandomPassword                               mysql-password          created  
    +   └─ azure-nextgen:resources/latest:ResourceGroup              rg                      created  
 
Outputs:
    serverEndpoint : "21.55.179.245:7233"
    starterEndpoint: "http://21.55.177.186:8080/async?name="
    webEndpoint    : "http://52.136.6.198:8088"

Resources:
    + 13 created

Duration: 7m48s
    ```

1.  Start a workflow:

    ```
    $ pulumi stack output starterEndpoint
    http://20.54.177.186:8080/async?name=
    $ curl $(pulumi stack output starterEndpoint)World
    Started workflow ID=World, RunID=b4f6db00-bb2f-498b-b620-caad81c91a81% 
    ```

1. Navigate to Temporal Web console:

    ```
    $ pulumi stack output webEndpoint
    http://51.137.6.198:8088 # Open in your browser
    ```
